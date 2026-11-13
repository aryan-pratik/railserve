'use client'

import type { ComponentProps } from 'react'
import { inputBase } from '@/components/ui'

/**
 * A filter select that applies the moment it changes, by submitting the
 * form it sits in. Analytics is read by flicking between outlets and
 * aggregators, and an Apply button between every look is a click nobody
 * should have to make.
 */
export function AutoSelect({ className = '', ...props }: ComponentProps<'select'>) {
  return (
    <select
      {...props}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={`${inputBase} w-full lg:w-auto lg:max-w-52 ${className}`}
    />
  )
}
