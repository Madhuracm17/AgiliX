import { ConsoleLogger, LogLevel } from '@nestjs/common';

/**
 * Nest logger for the MCP process.
 *
 * With the stdio transport, stdout carries ONLY MCP protocol messages (JSON-RPC).
 * Nest's default ConsoleLogger writes normal log levels to stdout, which would
 * corrupt the protocol, so this logger sends every level to stderr instead.
 */
export class StderrLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    _writeStreamType?: 'stdout' | 'stderr',
  ): void {
    super.printMessages(messages, context, logLevel, 'stderr');
  }
}

/**
 * Safety net for any code that calls console.log / console.info / console.debug
 * directly: route it to stderr so it can never corrupt the MCP protocol on stdout.
 * (console.warn and console.error already write to stderr.)
 */
export function redirectConsoleToStderr(): void {
  const writeToStderr = (...args: unknown[]): void => {
    console.error(...args);
  };

  console.log = writeToStderr;
  console.info = writeToStderr;
  console.debug = writeToStderr;
}