import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IndexEnsureService } from './index-ensure.service';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: async () => {
        const autoIndex =
          (process.env.MONGOOSE_AUTO_INDEX ?? '').toLowerCase() !== 'false';

        const uri = (process.env.MONGO_URI ?? '').trim();
        if (!uri) {
          throw new Error(
            'MONGO_URI is required. Start the API via `pnpm api:serve` (dotenvx) or export MONGO_URI before running.'
          );
        }
        return { uri, autoIndex };
      },
    }),
  ],
  providers: [IndexEnsureService],
  exports: [MongooseModule],
})
export class MongodbModule {}
