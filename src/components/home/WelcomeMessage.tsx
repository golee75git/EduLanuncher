export function greetingForHour(hour: number): string {
  if (hour < 5 || hour >= 17) {
    return "좋은 저녁이에요";
  }
  if (hour < 12) {
    return "좋은 아침이에요";
  }
  return "좋은 오후예요";
}

export function WelcomeMessage({ now = new Date() }: { now?: Date }) {
  return (
    <section className="px-7">
      <h2 className="text-[15px] font-bold text-desk">{greetingForHour(now.getHours())}</h2>
      <p className="mt-0.5 text-[11px] text-quiet">오늘 필요한 업무를 빠르게 시작하세요.</p>
    </section>
  );
}
