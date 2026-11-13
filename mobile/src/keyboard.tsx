import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Keyboard, Platform, ScrollView, View, type ScrollViewProps } from 'react-native'

/**
 * A scroll view whose text fields stay above the keyboard.
 *
 * The "What happened?" box sits at the very bottom of the delivery screen,
 * which is exactly where the keyboard opens. On phones where the window does
 * not shrink for the keyboard (Android drawing edge to edge, which is every
 * recent one) the box was simply covered: the rider typed a reason they could
 * not see, and could not reach the button under it.
 *
 * KeyboardAvoidingView is not used because what it should do depends on
 * whether the system already resized the window, and that differs by phone,
 * by Android version and by navigation mode. This measures instead of
 * guessing: when the keyboard appears it asks where the keyboard's top edge
 * is and where this view's bottom edge is, pads the content by exactly the
 * overlap (zero when the system resized the window itself), and scrolls the
 * focused field into the space that is left. The same code is therefore
 * right on every phone, including ones it has never run on.
 *
 * A field tells it where it is with `useRevealOnFocus`.
 */

type Measurable = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void }

const RevealContext = createContext<(node: Measurable | null) => void>(() => {})

/** Space kept between a focused field and the keyboard, so its button shows too. */
const BREATHING_ROOM = 96

export function KeyboardScroll({ children, contentContainerStyle, onScroll, ...props }: ScrollViewProps) {
  const frame = useRef<View>(null)
  const scroll = useRef<ScrollView>(null)
  const offset = useRef(0)
  const keyboardTop = useRef<number | null>(null)
  const focused = useRef<Measurable | null>(null)
  const [pad, setPad] = useState(0)

  const reveal = useCallback((node: Measurable | null) => {
    if (node) focused.current = node
    const target = focused.current
    const top = keyboardTop.current
    if (!target || top === null) return
    target.measureInWindow((_x, y, _w, h) => {
      const hidden = y + h + BREATHING_ROOM - top
      if (hidden > 0) scroll.current?.scrollTo({ y: offset.current + hidden, animated: true })
    })
  }, [])

  useEffect(() => {
    // iOS announces the keyboard before it moves, Android only after.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (e) => {
      keyboardTop.current = e.endCoordinates.screenY
      frame.current?.measureInWindow((_x, y, _w, h) => {
        // How much of this view the keyboard covers. Zero when the system
        // already shrank the window, so nothing is ever padded twice.
        setPad(Math.max(0, y + h - e.endCoordinates.screenY))
        // After the padding has been laid out, there is room to scroll into.
        setTimeout(() => reveal(null), 120)
      })
    })
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = null
      focused.current = null
      setPad(0)
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [reveal])

  return (
    <View ref={frame} style={{ flex: 1 }} collapsable={false}>
      <RevealContext.Provider value={reveal}>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={32}
          {...props}
          onScroll={(e) => {
            offset.current = e.nativeEvent.contentOffset.y
            onScroll?.(e)
          }}
          contentContainerStyle={[contentContainerStyle, pad > 0 ? { paddingBottom: pad + 24 } : null]}
        >
          {children}
        </ScrollView>
      </RevealContext.Provider>
    </View>
  )
}

/**
 * For a text field inside a KeyboardScroll: spread `ref` and `onFocus` onto
 * the field's wrapper View and TextInput. The wrapper is what gets measured,
 * so it can include the buttons that belong with the field.
 */
export function useRevealOnFocus() {
  const reveal = useContext(RevealContext)
  const ref = useRef<View>(null)
  const onFocus = useCallback(() => {
    // A beat, so a field that has only just been shown has been laid out.
    setTimeout(() => reveal(ref.current), 60)
  }, [reveal])
  return { ref, onFocus }
}
