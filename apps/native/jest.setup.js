// @testing-library/react-native v12.4+ registers its jest matchers
// automatically, so no extend-expect import is needed here.
//
// react-native-reanimated is mocked via __mocks__/react-native-reanimated.js
// (jest applies node_modules mocks from that directory automatically), because
// the real module loads a native worklets TurboModule at import time.
