'use client'

import type { FieldSelectProps } from './AnalyticsField'
import { Select } from './Select'

/**
 * A filter select that applies the moment it changes, by submitting the
 * QueryForm it sits in. Reports are read by flicking between outlets and
 * aggregators; an Apply click between every look is one nobody should make.
 * Pass `submitOnChange={false}` for one that waits for Apply.
 */
export function AutoSelect({ submitOnChange = true, ...rest }: FieldSelectProps & { submitOnChange?: boolean }) {
  return <Select submitOnChange={submitOnChange} {...rest} />
}
