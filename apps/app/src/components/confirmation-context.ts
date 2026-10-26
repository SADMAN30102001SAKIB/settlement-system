import { createContext, useContext } from 'react';

export interface Confirmation {
  title: string;
  message: string;
  action: string;
  destructive?: boolean;
}

export const ConfirmationContext = createContext<
  ((options: Confirmation) => Promise<boolean>) | null
>(null);

export function useConfirmation() {
  const confirm = useContext(ConfirmationContext);
  if (confirm === null) throw new Error('Missing confirmation provider');
  return confirm;
}
