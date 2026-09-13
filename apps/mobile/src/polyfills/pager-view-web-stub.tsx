import { forwardRef } from 'react';
import { ScrollView, type ViewProps } from 'react-native';

const PagerView = forwardRef<
  ScrollView,
  ViewProps & {
    initialPage?: number;
    onPageSelected?: (e: { nativeEvent: { position: number } }) => void;
  }
>(function PagerView(props, ref) {
  return <ScrollView ref={ref} horizontal pagingEnabled {...props} />;
});

export default PagerView;
