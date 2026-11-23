const dateOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'
};
const defaultDateFormatter = new Intl.DateTimeFormat('en', { ...dateOptions, timeZone: 'Asia/Bangkok' });

export function dateFormatter(timeZone: string | undefined) {
  if (!timeZone || timeZone.length > 100) return defaultDateFormatter;
  try {
    return new Intl.DateTimeFormat('en', { ...dateOptions, timeZone });
  } catch {
    return defaultDateFormatter;
  }
}
