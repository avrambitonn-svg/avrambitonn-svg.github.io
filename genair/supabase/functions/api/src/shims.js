// Node globals the server's modules use (Buffer, process). The bundler injects these wherever a module
// refers to them, so they exist before any module runs. In Deno, node:process reads Deno.env.
import { Buffer } from 'node:buffer';
import process from 'node:process';

export { Buffer, process };
