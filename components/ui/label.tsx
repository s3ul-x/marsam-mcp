import * as React from "react";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "text-[11px] font-medium tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
