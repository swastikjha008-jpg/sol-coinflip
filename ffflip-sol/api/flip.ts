import { handleFlip } from "../server/handlers.js";
export function POST(req: Request) { return handleFlip(req); }
