import log from 'electron-log'
import { app } from 'electron'

// Configure electron-log
log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.transports.file.maxSize = 5 * 1024 * 1024 // 5MB

// Set log file location
log.transports.file.resolvePathFn = () => {
  const appPath = app.getPath('userData')
  return `${appPath}/logs/burnbar.log`
}

// Custom format
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}'

export const logger = {
  info: (message: string, ...args: unknown[]) => {
    log.info(message, ...args)
  },
  warn: (message: string, ...args: unknown[]) => {
    log.warn(message, ...args)
  },
  error: (message: string, ...args: unknown[]) => {
    log.error(message, ...args)
  },
  debug: (message: string, ...args: unknown[]) => {
    log.debug(message, ...args)
  }
}
