/**
 * @author: @dorianbaffier
 * @description: Smooth Tab
 * @version: 1.0.0
 * @date: 2025-06-26
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 */

import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  content?: React.ReactNode;
  cardContent?: React.ReactNode;
  color: string;
}

const WaveformPath = () => (
  <motion.path
    animate={{
      x: [0, 10, 0],
      transition: {
        duration: 5,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      },
    }}
    d="M0 50 
           C 20 40, 40 30, 60 50
           C 80 70, 100 60, 120 50
           C 140 40, 160 30, 180 50
           C 200 70, 220 60, 240 50
           C 260 40, 280 30, 300 50
           C 320 70, 340 60, 360 50
           C 380 40, 400 30, 420 50
           L 420 100 L 0 100 Z"
    initial={false}
  />
);

function TabCardContent({
  title,
  description,
  fillClass,
}: {
  title: string;
  description: string;
  fillClass: string;
}) {
  return (
    <div className="relative h-full">
      <div className="absolute inset-0 overflow-hidden">
        <svg
          aria-hidden="true"
          className="absolute bottom-0 h-32 w-full"
          preserveAspectRatio="none"
          role="presentation"
          viewBox="0 0 420 100"
        >
          <motion.g
            animate={{ opacity: 0.15 }}
            initial={{ opacity: 0 }}
            style={{ fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1 }}
            transition={{ duration: 0.5 }}
          >
            <WaveformPath />
          </motion.g>
          <motion.g
            animate={{ opacity: 0.1 }}
            initial={{ opacity: 0 }}
            style={{ fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1, transform: 'translateY(10px)' }}
            transition={{ duration: 0.5 }}
          >
            <WaveformPath />
          </motion.g>
        </svg>
      </div>
      <div className="relative flex h-full flex-col p-6">
        <div className="space-y-2">
          <h3 className="bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 font-semibold text-2xl tracking-tight [text-shadow:_0_1px_1px_rgb(0_0_0_/_10%)]">
            {title}
          </h3>
          <p className="max-w-[90%] text-black/50 text-sm leading-relaxed dark:text-white/50">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_TABS: TabItem[] = [
  {
    id: "Models",
    title: "Models",
    description: "Choose the model you want to use",
    color: "bg-blue-500 hover:bg-blue-600",
  },
  {
    id: "MCPs",
    title: "MCPs",
    description: "Choose the MCP you want to use",
    color: "bg-purple-500 hover:bg-purple-600",
  },
  {
    id: "Agents",
    title: "Agents",
    description: "Choose the agent you want to use",
    color: "bg-emerald-500 hover:bg-emerald-600",
  },
  {
    id: "Users",
    title: "Users",
    description: "Choose the user you want to use",
    color: "bg-amber-500 hover:bg-amber-600",
  },
];

interface SmoothTabProps {
  items?: TabItem[];
  defaultTabId?: string;
  className?: string;
  activeColor?: string;
  value?: string;
  selected?: string;
  onChange?: (tabId: string) => void;
  stageClassName?: string;
  children?: React.ReactNode;
}

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? "100%" : "-100%",
    opacity: 0,
    filter: "blur(8px)",
    scale: 0.95,
    position: "absolute" as const,
  }),
  center: {
    x: 0,
    opacity: 1,
    filter: "blur(0px)",
    scale: 1,
    position: "absolute" as const,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? "100%" : "-100%",
    opacity: 0,
    filter: "blur(8px)",
    scale: 0.95,
    position: "absolute" as const,
  }),
};

const transition = {
  duration: 0.4,
  ease: [0.32, 0.72, 0, 1],
};

function indicatorTone(token: string): "light" | "dark" | null {
  const bare = token.replace(/^(?:dark:)/, "");
  if (bare.startsWith("hover:") || !bare.startsWith("bg-")) return null;
  const name = bare.slice(3);
  if (name === "white" || name === "zinc-50" || name === "zinc-100" || name === "zinc-200") return "light";
  const neutral = name.match(/^(?:slate|gray|grey|neutral|stone)-(\d+)$/);
  if (neutral) return Number(neutral[1]) <= 200 ? "light" : "dark";
  if (/^zinc-\d+$/.test(name)) return "dark";
  const hex = name.match(/^\[#([0-9a-fA-F]{6})\]$/);
  if (hex) {
    const value = hex[1];
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.72 ? "light" : "dark";
  }
  return "dark";
}

function selectedLabelClass(color?: string) {
  const tokens = (color || "").split(/\s+/);
  let light = false;
  let darkLight = false;
  let sawDark = false;
  for (const token of tokens) {
    const tone = indicatorTone(token);
    if (!tone) continue;
    if (token.startsWith("dark:")) {
      sawDark = true;
      if (tone === "light") darkLight = true;
    } else if (tone === "light") {
      light = true;
    }
  }
  const lightWhenDark = sawDark ? darkLight : light;
  // dark: utilities are emitted under :where(), so a later text-white wins.
  // The important modifier keeps dark ink on a light pill.
  if (light && lightWhenDark) return "text-[#17211d]";
  if (!light && lightWhenDark) return "text-white dark:!text-[#17211d]";
  if (light && !lightWhenDark) return "text-[#17211d] dark:!text-white";
  return "text-white";
}

export default function SmoothTab({
  items = DEFAULT_TABS,
  defaultTabId = DEFAULT_TABS[0].id,
  className,
  activeColor = "bg-[#1F9CFE]",
  value,
  selected: selectedProp,
  onChange,
  stageClassName,
  children,
}: SmoothTabProps) {
  const fallbackId = items.some((item) => item.id === defaultTabId) ? defaultTabId : (items[0]?.id ?? defaultTabId);
  const [uncontrolled, setUncontrolled] = React.useState<string>(fallbackId);
  const selected = selectedProp ?? value ?? uncontrolled;

  React.useEffect(() => {
    if (selectedProp !== undefined || value !== undefined) return;
    if (items.some((item) => item.id === uncontrolled)) return;
    setUncontrolled(items[0]?.id ?? defaultTabId);
  }, [items, uncontrolled, selectedProp, value, defaultTabId]);
  const [direction, setDirection] = React.useState(0);
  const [dimensions, setDimensions] = React.useState({ width: 0, left: 0 });

  const buttonRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const updateDimensions = () => {
      const selectedButton = buttonRefs.current.get(selected);
      const container = containerRef.current;

      if (selectedButton && container) {
        const rect = selectedButton.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        setDimensions({
          width: rect.width,
          left: rect.left - containerRect.left,
        });
      }
    };

    requestAnimationFrame(() => {
      updateDimensions();
    });

    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, [selected]);

  const handleTabClick = (tabId: string) => {
    const currentIndex = items.findIndex((item) => item.id === selected);
    const newIndex = items.findIndex((item) => item.id === tabId);
    setDirection(newIndex > currentIndex ? 1 : -1);
    if (selectedProp === undefined && value === undefined) setUncontrolled(tabId);
    onChange?.(tabId);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleTabClick(tabId);
    }
  };

  const selectedItem = items.find((item) => item.id === selected);

  const tabBar = (
      <div
        aria-label="Smooth tabs"
        className={cn(
          "relative flex w-full items-center justify-between gap-1 rounded-xl border bg-background py-1",
          className,
        )}
        ref={containerRef}
        role="tablist"
      >
        <motion.div
          animate={{
            width: Math.max(0, dimensions.width - 8),
            x: dimensions.left + 4,
            opacity: 1,
          }}
          className={cn("absolute z-[1] rounded-lg", selectedItem?.color || activeColor)}
          initial={false}
          style={{ height: "calc(100% - 8px)", top: "4px" }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
        <div
          className="relative z-[2] grid w-full gap-1"
          style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
        >
          {items.map((item) => {
            const isSelected = selected === item.id;
            return (
              <button
                aria-controls={`panel-${item.id}`}
                aria-selected={isSelected}
                className={cn(
                  "relative flex items-center justify-center gap-0.5 truncate rounded-lg px-2 py-1.5 text-sm font-medium",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected ? selectedLabelClass(selectedItem?.color || activeColor) : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                id={`tab-${item.id}`}
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                onKeyDown={(e) => handleKeyDown(e, item.id)}
                ref={(el) => {
                  if (el) buttonRefs.current.set(item.id, el);
                  else buttonRefs.current.delete(item.id);
                }}
                role="tab"
                tabIndex={isSelected ? 0 : -1}
                type="button"
              >
                <span className="truncate">{item.title}</span>
              </button>
            );
          })}
        </div>
      </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {tabBar}
      {children !== undefined ? (
        <div className="w-full">{children}</div>
      ) : (
        <div className={cn("relative h-[200px] w-full rounded-lg border bg-card", stageClassName)}>
          <div className="absolute inset-0 overflow-hidden rounded-lg">
            <AnimatePresence custom={direction} initial={false} mode="popLayout">
              <motion.div
                animate="center"
                className="absolute inset-0 h-full w-full bg-card"
                custom={direction}
                exit="exit"
                initial="enter"
                key={`card-${selected}`}
                transition={transition as never}
                variants={slideVariants as never}
              >
                {selectedItem?.cardContent ??
                  (selectedItem && (
                    <TabCardContent
                      description={selectedItem.description ?? ""}
                      fillClass={selectedItem.color.split(" ").at(0)?.replace("bg-", "") ?? "blue-500"}
                      title={selectedItem.title}
                    />
                  ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
