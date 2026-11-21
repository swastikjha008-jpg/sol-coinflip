import { handleConfig } from "../server/handlers.js";
export function GET(req: Request) { return handleConfig(req); }
