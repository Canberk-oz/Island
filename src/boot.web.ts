// Web is only a development harness (the product is the Android app). Skia
// needs its WebAssembly build loaded before any module that draws is imported.
import '@expo/metro-runtime';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { registerRootComponent } from 'expo';

LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(async () => {
  const App = (await import('./App')).default;
  registerRootComponent(App);
});
