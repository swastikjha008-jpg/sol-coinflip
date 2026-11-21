import { handleFlip } from "./handlers";
import { toNode } from "./node-adapter";
export default toNode((r) => handleFlip(r));
