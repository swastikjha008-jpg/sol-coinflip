import { handleConfig } from "./handlers";
import { toNode } from "./node-adapter";
export default toNode((r) => handleConfig(r));
