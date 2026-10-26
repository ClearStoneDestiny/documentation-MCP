import { Module } from "@nestjs/common";
import { readCacheOptions } from "./utils/read-cache-options.util.js";
import { FileCacheService } from "./file-cache.service.js";
import { CACHE_OPTIONS } from "./constants/cache-options.constant.js";

@Module({
  providers: [
    { provide: CACHE_OPTIONS, useFactory: readCacheOptions },
    FileCacheService,
  ],
  exports: [FileCacheService],
})
export class CacheModule {}
