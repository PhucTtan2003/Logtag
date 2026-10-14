import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * ModalPortal
 * Render children ra thẳng document.body
 * để modal không bị ảnh hưởng bởi transform/overflow của parent
 */
export default function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

// 👇 dòng này chỉ để TypeScript chắc chắn coi file là module khi dùng --isolatedModules
export {};