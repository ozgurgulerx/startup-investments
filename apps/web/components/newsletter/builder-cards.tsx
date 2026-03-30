interface PlaybookEntry {
  title: string;
  stat: string;
  description: string;
}

const ICONS: Record<string, string> = {
  'Data > Models': '\u{1F4CA}',
  'Agents Are Infrastructure Now': '\u{1F916}',
  'Physical AI Is the Next Frontier': '\u{2699}',
};

export function BuilderCards({ data }: { data: PlaybookEntry[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {data.map((item, i) => (
        <div
          key={i}
          className="border border-border/40 rounded-lg p-5 bg-card/50"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="num-lg text-accent">{i + 1}</span>
            <span className="label-xs text-muted-foreground">{item.title}</span>
          </div>
          <p className="num-md text-foreground mb-2">{item.stat}</p>
          <p className="body-sm text-muted-foreground leading-relaxed">
            {item.description}
          </p>
        </div>
      ))}
    </div>
  );
}
