export type ToastKind = 'success' | 'error';

export interface ToastDetail {
  kind: ToastKind;
  message: string;
}

export const TOAST_EVENT = 'iptvmaster:toast';

export function showToast(kind: ToastKind, message: string): void {
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { kind, message } }),
  );
}
