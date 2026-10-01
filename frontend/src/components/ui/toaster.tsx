import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

/** Keywords that indicate a critical toast that must always be shown */
const CRITICAL_KEYWORDS = [
  "camera", "microphone", "permission", "error", "failed",
  "denied", "submit", "connection", "timeout", "terminated",
];

function isCriticalToast(title?: string, description?: string, variant?: string): boolean {
  if (variant === "destructive") return true;
  const text = `${title || ""} ${description || ""}`.toLowerCase();
  return CRITICAL_KEYWORDS.some((kw) => text.includes(kw));
}

function isInterviewPath(): boolean {
  const path = window.location.pathname;
  return path.includes("/take-interview") || path.includes("/i/");
}

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts
        .filter(({ title, description, variant, ...rest }) => {
          // During interview, only show critical toasts
          if (isInterviewPath() && !isCriticalToast(title as string, description as string, (rest as any).variant ?? variant)) {
            return false;
          }
          return true;
        })
        .map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
