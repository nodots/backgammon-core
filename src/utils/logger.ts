/**
 * Logger with pluggable transports. Default behavior is unchanged from the
 * pre-transport implementation: a single ConsoleTransport that prints
 * `[source] [timestamp] [LEVEL] message | Called from: ...` to console.*.
 *
 * Additional sinks (DB, Datadog, remote HTTP) register themselves at app
 * boot via `logger.addTransport(...)`. Transports must be fail-soft:
 * never throw out of `write`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

interface CallerInfo {
  functionName: string
  fileName: string
  lineNumber: number
  columnNumber: number
  stack?: string
}

export interface LogEvent {
  level: LogLevel
  message: string
  args: unknown[]
  timestamp: string
  source: string
  caller?: CallerInfo | null
  context?: Record<string, unknown>
}

export interface Transport {
  name: string
  minLevel?: LogLevel
  write(event: LogEvent): void
}

export class ConsoleTransport implements Transport {
  name = 'console'
  minLevel: LogLevel
  enabled: boolean

  constructor(options: { minLevel?: LogLevel; enabled?: boolean } = {}) {
    this.minLevel = options.minLevel ?? 'debug'
    this.enabled = options.enabled !== false
  }

  write(event: LogEvent): void {
    if (!this.enabled) return
    const prefix = `[${event.source}]`
    let formatted = `${prefix} [${event.timestamp}] [${event.level.toUpperCase()}] ${event.message}`
    if (event.caller) {
      formatted += ` | Called from: ${event.caller.functionName} (${event.caller.fileName}:${event.caller.lineNumber})`
    }
    const fn =
      event.level === 'debug'
        ? console.debug
        : event.level === 'info'
        ? console.info
        : event.level === 'warn'
        ? console.warn
        : console.error
    fn(formatted, ...event.args)
  }
}

interface LoggerOptions {
  level?: LogLevel
  enableConsole?: boolean
  includeCallerInfo?: boolean
  source?: string
}

class Logger {
  private level: LogLevel
  private includeCallerInfo: boolean
  private readonly source: string
  private transports: Transport[] = []
  private consoleTransport: ConsoleTransport

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || 'info'
    this.includeCallerInfo = options.includeCallerInfo !== false
    this.source = options.source || 'Core'
    this.consoleTransport = new ConsoleTransport({
      enabled: options.enableConsole !== false,
    })
    this.transports.push(this.consoleTransport)
  }

  private shouldLog(messageLevel: LogLevel): boolean {
    return LEVEL_RANK[messageLevel] >= LEVEL_RANK[this.level]
  }

  private getCallerInfo(): CallerInfo | null {
    if (!this.includeCallerInfo) return null

    try {
      const stack = new Error().stack
      if (!stack) return null

      const stackLines = stack.split('\n')

      let callerLine = ''
      for (let i = 0; i < stackLines.length; i++) {
        const line = stackLines[i]
        if (line.includes('Logger.') || line.includes('logger.ts')) {
          continue
        }
        if (line.includes('at ') && !line.includes('node_modules')) {
          callerLine = line
          break
        }
      }

      if (!callerLine) return null

      const match = callerLine.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/)
      if (match) {
        return {
          functionName: match[1],
          fileName: match[2].split('/').pop() || match[2],
          lineNumber: parseInt(match[3]),
          columnNumber: parseInt(match[4]),
          stack: stack,
        }
      }

      const fallbackMatch = callerLine.match(/at\s+(.+?):(\d+):(\d+)/)
      if (fallbackMatch) {
        return {
          functionName: 'anonymous',
          fileName: fallbackMatch[1].split('/').pop() || fallbackMatch[1],
          lineNumber: parseInt(fallbackMatch[2]),
          columnNumber: parseInt(fallbackMatch[3]),
          stack: stack,
        }
      }

      return null
    } catch (error) {
      return null
    }
  }

  private dispatch(level: LogLevel, message: string, args: unknown[]): void {
    if (!this.shouldLog(level)) return
    const event: LogEvent = {
      level,
      message,
      args,
      timestamp: new Date().toISOString(),
      source: this.source,
      caller: this.getCallerInfo(),
    }
    for (const t of this.transports) {
      if (t.minLevel && LEVEL_RANK[level] < LEVEL_RANK[t.minLevel]) continue
      try {
        t.write(event)
      } catch {
        // Transports must never break the caller.
      }
    }
  }

  debug(message: string, ...args: any[]): void {
    this.dispatch('debug', message, args)
  }

  info(message: string, ...args: any[]): void {
    this.dispatch('info', message, args)
  }

  warn(message: string, ...args: any[]): void {
    this.dispatch('warn', message, args)
  }

  error(message: string, ...args: any[]): void {
    this.dispatch('error', message, args)
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  setConsoleEnabled(enabled: boolean): void {
    this.consoleTransport.enabled = enabled
  }

  setIncludeCallerInfo(enabled: boolean): void {
    this.includeCallerInfo = enabled
  }

  getDetailedCallerInfo(): CallerInfo | null {
    return this.getCallerInfo()
  }

  addTransport(transport: Transport): void {
    this.transports.push(transport)
  }

  removeTransport(name: string): void {
    this.transports = this.transports.filter((t) => t.name !== name)
  }

  getTransports(): readonly Transport[] {
    return this.transports
  }
}

const env: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? process.env : {}
const envLevel = (env.NODOTS_LOG_LEVEL as LogLevel) || 'info'
const envSilent = env.NODOTS_LOG_SILENT === '1'
const includeCaller =
  env.NODOTS_LOG_CALLER === '1' || env.NODOTS_LOG_CALLER === undefined
const defaultLogger = new Logger({
  level: envLevel,
  enableConsole: !envSilent,
  includeCallerInfo: includeCaller,
})

export const logger = defaultLogger

export { Logger }

export const debug = (message: string, ...args: any[]) =>
  defaultLogger.debug(message, ...args)
export const info = (message: string, ...args: any[]) =>
  defaultLogger.info(message, ...args)
export const warn = (message: string, ...args: any[]) =>
  defaultLogger.warn(message, ...args)
export const error = (message: string, ...args: any[]) =>
  defaultLogger.error(message, ...args)

export const setLogLevel = (level: LogLevel) => defaultLogger.setLevel(level)
export const setConsoleEnabled = (enabled: boolean) =>
  defaultLogger.setConsoleEnabled(enabled)
export const setIncludeCallerInfo = (enabled: boolean) =>
  defaultLogger.setIncludeCallerInfo(enabled)
export const getDetailedCallerInfo = () => defaultLogger.getDetailedCallerInfo()

export const addTransport = (transport: Transport) =>
  defaultLogger.addTransport(transport)
export const removeTransport = (name: string) =>
  defaultLogger.removeTransport(name)
