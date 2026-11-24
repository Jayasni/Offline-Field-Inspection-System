import {describe,it,expect} from "vitest";
import {isAllowedImage,nextRetryDelay,isRetryableStatus} from "./utils";
describe("photo validation",()=>{it("accepts supported image under 8MB",()=>expect(isAllowedImage("image/jpeg",1024)).toBe(true));it("rejects unsupported type",()=>expect(isAllowedImage("application/pdf",1024)).toBe(false));it("rejects files above 8MB",()=>expect(isAllowedImage("image/png",8*1024*1024+1)).toBe(false));});
describe("sync retry policy",()=>{it("uses exponential backoff with a cap",()=>{expect(nextRetryDelay(0)).toBe(1000);expect(nextRetryDelay(1)).toBe(2000);expect(nextRetryDelay(10)).toBe(30000)});it("retries transient server/network statuses",()=>{expect(isRetryableStatus(503)).toBe(true);expect(isRetryableStatus(401)).toBe(false)});});
