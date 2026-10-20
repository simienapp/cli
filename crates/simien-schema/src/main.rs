//! `simien-schema`: the binary the simien CLI ships. JSON in on stdin, JSON out on stdout.
//!
//! - `plan`: `{ "schemaTs", "catalog" }` → the migration from the database to `schema.ts`, plus
//!   the generated data model for the schema it will reach.
//! - `pull`: `{ "catalog" }` → `schema.ts` and the data model, written from the database.
//!
//! A mistake in `schema.ts` is a normal answer (`"ok": false` with a line and column), not a crash.

use std::io::Read as _;

use serde::Deserialize;
use serde_json::{Value, json};
use simien_schema::{catalog, parse, plan, print};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    #[serde(default)]
    schema_ts: Option<String>,
    catalog: catalog::Catalog,
}

fn run(command: &str, input: Input) -> Value {
    let read = catalog::read(&input.catalog);
    match command {
        "pull" => json!({
            "ok": true,
            "schema": read.schema,
            "schemaTs": print::schema_ts(&read.schema),
            "dataModel": print::data_model(&read.schema),
            "unmanaged": read.unmanaged,
        }),
        "plan" => {
            let Some(text) = input.schema_ts else {
                return json!({ "ok": false, "error": { "message": "plan needs schemaTs" } });
            };
            let desired = match parse::parse(&text) {
                Ok(schema) => schema,
                Err(error) => return json!({ "ok": false, "error": error }),
            };
            // A table Simien would create that already exists unmanaged is a clash, not a create.
            for table in desired
                .tables
                .iter()
                .map(|t| t.name.clone())
                .chain(desired.edges.iter().map(|e| e.table()))
            {
                if let Some(unmanaged) = read.unmanaged.iter().find(|u| u.table == table) {
                    return json!({ "ok": false, "error": { "message": format!(
                        "table {} already exists in Postgres but isn't a Simien table ({}). Rename one of them.",
                        unmanaged.table, unmanaged.reason
                    ) } });
                }
            }
            json!({
                "ok": true,
                "plan": plan::plan(&read.schema, &desired),
                "current": read.schema,
                "schema": desired,
                "dataModel": print::data_model(&desired),
                "unmanaged": read.unmanaged,
            })
        }
        other => json!({ "ok": false, "error": { "message": format!("unknown command {other}; use plan or pull") } }),
    }
}

fn main() {
    let command = std::env::args().nth(1).unwrap_or_default();
    if command == "--version" {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let mut text = String::new();
    let output = match std::io::stdin()
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())
        .and_then(|_| serde_json::from_str::<Input>(&text).map_err(|e| format!("bad input: {e}")))
    {
        Ok(input) => run(&command, input),
        Err(message) => json!({ "ok": false, "error": { "message": message } }),
    };
    println!("{output}");
    if output["ok"] != json!(true) {
        std::process::exit(1);
    }
}
