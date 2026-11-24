export function isAllowedImage(type:string,size:number){return ["image/jpeg","image/png","image/webp"].includes(type)&&size>0&&size<=8*1024*1024}
export function nextRetryDelay(attempt:number){return Math.min(30000,1000*Math.pow(2,Math.max(0,attempt)))}
export function isRetryableStatus(status:number){return status===408||status===429||status>=500}
