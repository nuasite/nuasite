import { type ClassNameValue, twMerge } from 'tailwind-merge'

// twMerge already joins strings and arrays and drops falsy values.
export const cn = (...inputs: ClassNameValue[]) => twMerge(...inputs)
