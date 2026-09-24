import { useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from '@/lib/pdf';

type Props = {
  /** Called with the full SVG path whenever a stroke ends. */
  onChange: (path: string) => void;
  initialPath?: string;
};

/** Draws in a fixed SIGNATURE_WIDTH x SIGNATURE_HEIGHT coordinate space, scaled to the view. */
export function SignaturePad({ onChange, initialPath = '' }: Props) {
  const theme = useTheme();
  const [path, setPath] = useState(initialPath);
  const pathRef = useRef(initialPath);
  const scale = useRef(1);

  const addPoint = (command: 'M' | 'L', e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    pathRef.current += ` ${command}${(locationX / scale.current).toFixed(1)},${(locationY / scale.current).toFixed(1)}`;
    setPath(pathRef.current);
  };

  return (
    <View
      style={[styles.pad, { borderColor: theme.border, backgroundColor: '#fff' }]}
      onLayout={(e) => {
        scale.current = e.nativeEvent.layout.width / SIGNATURE_WIDTH;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => addPoint('M', e)}
      onResponderMove={(e) => addPoint('L', e)}
      onResponderRelease={() => onChange(pathRef.current.trim())}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`} pointerEvents="none">
        <Path d={path} stroke="#111" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    width: '100%',
    aspectRatio: SIGNATURE_WIDTH / SIGNATURE_HEIGHT,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
