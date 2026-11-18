import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Repack from '@callstack/repack';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default (env) => {
  const {
    mode = 'development',
    context = __dirname,
    entry = './index.js',
    platform = process.env.PLATFORM || 'android',
  } = env;

  return {
    mode,
    context,
    entry,
    resolve: {
      ...Repack.getResolveOptions(platform),
      alias: {
        '@shared': path.resolve(__dirname, '../src/shared'),
      },
    },
    module: {
      rules: [
        ...Repack.getJsTransformRules(),
        ...Repack.getAssetTransformRules(),
      ],
    },
    plugins: [new Repack.RepackPlugin()],
  };
};
