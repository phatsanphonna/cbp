const dateOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset'
};
const defaultDateFormatter = new Intl.DateTimeFormat('en-GB', { ...dateOptions, timeZone: 'Asia/Bangkok' });

export function dateFormatter(timeZone: string | undefined) {
  if (!timeZone || timeZone.length > 100) return defaultDateFormatter;
  try {
    return new Intl.DateTimeFormat('en-GB', { ...dateOptions, timeZone });
  } catch {
    return defaultDateFormatter;
  }
}
