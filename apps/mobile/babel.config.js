module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 moved its Babel plugin into react-native-worklets. Without
    // it, every worklet silently runs on the JS thread instead of the UI
    // thread — animations still "work", just janky, with no error to notice.
    // Must stay last.
    plugins: ['react-native-worklets/plugin'],
  };
};
