// 샘플 사이트 공통: 한국 시간 기준 '지금 영업(진료) 중' 계산
// hours: 요일(0=일)별 [[시작분, 끝분], ...] 배열. 빈 배열이면 휴무.
window.SalpimSample = {
  now() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    return { day, min: (+p.hour) * 60 + (+p.minute) };
  },
  fmt(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); },
  status(hours, w) {
    w = Object.assign({ open: '지금 영업 중', brk: '쉬는 시간', end: '오늘 영업 끝', off: '오늘은 휴무' }, w);
    const { day, min } = this.now();
    const today = hours[day] || [];
    for (const [a, b] of today) if (min >= a && min < b) return { open: true, label: w.open + ', ' + this.fmt(b) + '까지', day };
    const later = today.find(([a]) => a > min);
    if (later) return { open: false, label: w.brk + ', ' + this.fmt(later[0]) + '에 다시 시작', day };
    return { open: false, label: today.length ? w.end : w.off, day };
  },
};
