import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Search } from "lucide-react";
import { MORSE_TO_CHAR } from "@/lib/morse";

// Invert dictionary to char -> morse
const CHAR_TO_MORSE: Record<string, string> = Object.entries(MORSE_TO_CHAR).reduce(
  (acc, [code, ch]) => {
    acc[ch] = code;
    return acc;
  },
  {} as Record<string, string>
);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "0123456789".split("");

interface MorseChartProps {
  trigger?: React.ReactNode;
  variant?: "button" | "compact";
}

export const MorseChart = ({ trigger, variant = "button" }: MorseChartProps) => {
  const [query, setQuery] = useState("");
  const q = query.trim().toUpperCase();

  const filter = (chars: string[]) =>
    !q
      ? chars
      : chars.filter((c) => c.includes(q) || (CHAR_TO_MORSE[c] ?? "").includes(query.trim()));

  const renderSymbols = (code: string) => (
    <div className="flex gap-1 items-center justify-center">
      {code.split("").map((s, i) => (
        <span
          key={i}
          className={
            s === "."
              ? "inline-block w-2.5 h-2.5 rounded-full bg-primary"
              : "inline-block w-6 h-2.5 rounded-full bg-primary"
          }
        />
      ))}
    </div>
  );

  const renderGrid = (chars: string[]) => {
    const filtered = filter(chars);
    if (filtered.length === 0) {
      return (
        <p className="text-center text-muted-foreground italic py-8">
          No matches for “{query}”
        </p>
      );
    }
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {filtered.map((ch) => {
          const code = CHAR_TO_MORSE[ch];
          if (!code) return null;
          return (
            <div
              key={ch}
              className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-secondary/40 hover:bg-secondary/80 hover:border-primary/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-md gradient-primary flex items-center justify-center text-primary-foreground text-xl font-black shrink-0">
                {ch}
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                {renderSymbols(code)}
                <span className="text-[10px] font-mono text-muted-foreground tracking-wider text-center">
                  {code}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const defaultTrigger =
    variant === "compact" ? (
      <Button variant="outline" size="sm" className="gap-2">
        <BookOpen className="w-4 h-4" />
        Morse Chart
      </Button>
    ) : (
      <Button variant="outline" size="lg" className="h-14 text-base font-semibold gap-2 border-2">
        <BookOpen className="w-5 h-5" />
        Morse Code Chart
      </Button>
    );

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" />
            Morse Code Reference
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            <span className="text-primary font-semibold">•</span> = short blink (dot) ·{" "}
            <span className="text-primary font-semibold">—</span> = long blink (dash)
          </p>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search letter, number, or morse code…"
            className="pl-9 h-11"
          />
        </div>

        <Tabs defaultValue="letters" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="letters">Letters (A–Z)</TabsTrigger>
            <TabsTrigger value="numbers">Numbers (0–9)</TabsTrigger>
          </TabsList>
          <ScrollArea className="flex-1 mt-3 -mx-2 px-2">
            <TabsContent value="letters" className="mt-0">
              {renderGrid(LETTERS)}
            </TabsContent>
            <TabsContent value="numbers" className="mt-0">
              {renderGrid(DIGITS)}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
