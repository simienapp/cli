// The Simien mark and the start banner, in the zega CLI's style: shown only with --human on a
// terminal. JSON output never carries them.

const INDENT = '  '
const WIDTH = 44

/** "simien" in the Ogre FIGlet font (figlet 1.8.0, `textSync('simien', { font: 'Ogre' })`). */
export const LOGO = [
  '     _           _',
  ' ___(_)_ __ ___ (_) ___ _ __',
  "/ __| | '_ ` _ \\| |/ _ \\ '_ \\",
  '\\__ \\ | | | | | | |  __/ | | |',
  '|___/_|_| |_| |_|_|\\___|_| |_|',
]

type Rgb = [number, number, number]
/** Simien blue. */
const MAIN: Rgb = [94, 176, 255]

const paint = (rgb: Rgb, text: string, color: boolean) => (color ? `\x1b[38;2;${rgb.join(';')}m${text}\x1b[39m` : text)
const dim = (text: string, color: boolean) => (color ? `\x1b[2m${text}\x1b[22m` : text)
const bold = (text: string, color: boolean) => (color ? `\x1b[1m${text}\x1b[22m` : text)

export function logo(color: boolean): string {
  return LOGO.map((row) => INDENT + paint(MAIN, row, color)).join('\n')
}

/** Whether to draw: --human, with a terminal on stdout. */
export const showLogo = (human: boolean | undefined) => human === true && process.stdout.isTTY === true

export interface BannerLine {
  label: string
  value: string
}

/** What `simien dev --human` prints once everything is up. */
export function startBanner(options: { version: string; tagline: string; lines: BannerLine[]; color: boolean }): string {
  const width = Math.max(...options.lines.map((line) => line.label.length)) + 2
  const out = ['', logo(options.color), '', `${INDENT}${options.tagline}  ${dim(`simien v${options.version}`, options.color)}`]
  out.push(INDENT + dim('─'.repeat(WIDTH), options.color), '')
  for (const line of options.lines) {
    out.push(`${INDENT}${paint(MAIN, '➜', options.color)}  ${bold(`${line.label}:`.padEnd(width), options.color)} ${line.value}`)
  }
  out.push('')
  return out.join('\n')
}
