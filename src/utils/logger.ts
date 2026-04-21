/**
 * Logger utility that prefixes all logs with '[Core]'
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LoggerOptions {
  level?: LogLevel
  enableConsole?: boolean
  includeCallerInfo?: boolean
}

interface CallerInfo {
  functionName: string
  fileName: string
  lineNumber: number
  columnNumber: number
  stack?: string
}

class Logger {
  private level: LogLevel
  private enableConsole: boolean
  private includeCallerInfo: boolean
  private readonly prefix = '[Core]'

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || 'info'
    this.enableConsole = options.enableConsole !== false
    this.includeCallerInfo = options.includeCallerInfo !== false
  }

  private shouldLog(messageLevel: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    }
    return levels[messageLevel] >= levels[this.level]
  }

  private getCallerInfo(): CallerInfo | null {
    if (!this.includeCallerInfo) return null

    try {
      const stack = new Error().stack
      if (!stack) return null

      // Parse the stack trace to get caller information
      const stackLines = stack.split('\n')

      // Find the first line that's not from the logger itself
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

      // Parse the caller line
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

      // Fallback for different stack formats
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

  private formatMessage(
    level: LogLevel,
    message: string,
    ...args: any[]
  ): string {
    const timestamp = new Date().toISOString()
    const callerInfo = this.getCallerInfo()

    let formattedMessage = `${
      this.prefix
    } [${timestamp}] [${level.toUpperCase()}] ${message}`

    if (callerInfo) {
      formattedMessage += ` | Called from: ${callerInfo.functionName} (${callerInfo.fileName}:${callerInfo.lineNumber})`
    }

    return formattedMessage
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug') && this.enableConsole) {
      console.debug(this.formatMessage('debug', message), ...args)
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info') && this.enableConsole) {
      console.info(this.formatMessage('info', message), ...args)
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn') && this.enableConsole) {
      console.warn(this.formatMessage('warn', message), ...args)
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error') && this.enableConsole) {
      console.error(this.formatMessage('error', message), ...args)
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  setConsoleEnabled(enabled: boolean): void {
    this.enableConsole = enabled
  }

  setIncludeCallerInfo(enabled: boolean): void {
    this.includeCallerInfo = enabled
  }

  getDetailedCallerInfo(): CallerInfo | null {
    return this.getCallerInfo()
  }
}

// Create default logger instance with env-based controls for speed.
// Guard the `process` access so core can be bundled into the browser;
// without this the module throws ReferenceError at import time.
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

// Export the default logger instance
export const logger = defaultLogger

// Export the Logger class for creating custom instances
export { Logger }

// Export convenience functions
export const debug = (message: string, ...args: any[]) =>
  defaultLogger.debug(message, ...args)
export const info = (message: string, ...args: any[]) =>
  defaultLogger.info(message, ...args)
export const warn = (message: string, ...args: any[]) =>
  defaultLogger.warn(message, ...args)
export const error = (message: string, ...args: any[]) =>
  defaultLogger.error(message, ...args)

// Export utility functions
export const setLogLevel = (level: LogLevel) => defaultLogger.setLevel(level)
export const setConsoleEnabled = (enabled: boolean) =>
  defaultLogger.setConsoleEnabled(enabled)
export const setIncludeCallerInfo = (enabled: boolean) =>
  defaultLogger.setIncludeCallerInfo(enabled)
export const getDetailedCallerInfo = () => defaultLogger.getDetailedCallerInfo()
