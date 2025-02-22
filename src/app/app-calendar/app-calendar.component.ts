import { AsyncPipe, CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, Subscription } from 'rxjs';
import { FooterComponent } from '../footer/footer.component';
import { HeaderComponent } from '../header/header.component';
import {
  AutoMode,
  CalendarData,
  CalendarGroupByMajor,
  CalendarGroupByMajorDetail,
  CalendarGroupBySubjectName,
  CalendarTableContent,
  CalendarTableContentInDate,
  CalendarTableContentInSession,
  RawCalendar,
} from '../types/calendar';
import { CalendarComponent } from './calendar/calendar.component';
import { ClassInfoComponent } from './class-info/class-info.component';
import { MoreInfoComponent } from './more-info/more-info.component';
import { processCalendar } from '../utils/calendar_processing';
import { EXCEL_PATH, JSON_PATH, SESSIONS } from '../constants/calendar';

@Component({
  selector: 'app-app-calendar',
  imports: [
    CommonModule,
    FormsModule,
    AsyncPipe,
    HeaderComponent,
    FooterComponent,
    CalendarComponent,
    ClassInfoComponent,
    MoreInfoComponent,
  ],
  templateUrl: './app-calendar.component.html',
  styleUrl: './app-calendar.component.scss',
})
export class AppCalendarComponent {
  SESSIONS = SESSIONS;
  EXCEL_PATH = EXCEL_PATH;

  readonly loading$: BehaviorSubject<boolean>;
  readonly calendar$: BehaviorSubject<CalendarData | undefined>;
  readonly calendarTableContent$: BehaviorSubject<CalendarTableContent>;

  title: string = '';
  showTab: 'class-info' | 'calendar' | 'more-info' = 'class-info';
  isConflict: boolean = false;
  autoTh: number = -1;
  oldAuto: AutoMode = 'none';

  calendarGroupByMajor: [string, CalendarGroupByMajorDetail][] = [];
  calendarGroupByMajorSub: Subscription;

  constructor(private cdr: ChangeDetectorRef) {
    this.loading$ = new BehaviorSubject<boolean>(true);
    this.calendar$ = new BehaviorSubject<CalendarData | undefined>(undefined);
    this.calendarTableContent$ = new BehaviorSubject<any>({});

    this.calendarGroupByMajorSub = this.calendar$.subscribe((calendar) => {
      this.calendarGroupByMajor = Object.entries(
        calendar?.calendarGroupByMajor || []
      ).sort((a, b) => a[0].localeCompare(b[0]));
    });
  }

  ngOnInit(): void {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    try {
      const response: any = await fetch(JSON_PATH);
      const data = await response.json();

      // Lấy tiêu đề
      this.title = data?.title || '';

      // Xử lý dữ liệu lịch học
      const calendar = processCalendar(
        (data?.data as Array<RawCalendar>) || []
      );
      this.calendar$.next(calendar);

      // Khởi tạo không gian cho bảng lịch dựa vào data lịch
      const calendarTableContent: CalendarTableContent = {};
      for (const date of calendar.dateList) {
        calendarTableContent[date] = <CalendarTableContentInDate>{};
        for (const session of SESSIONS)
          calendarTableContent[date][session] =
            [] as CalendarTableContentInSession;
      }
      this.calendarTableContent$.next(calendarTableContent);
    } catch (e: any) {
      console.error(e);
      alert('Có lỗi xảy ra, không thể tải dữ liệu!');
    } finally {
      this.loading$.next(false);
    }
  }

  checkSession(shift: number): 'morning' | 'afternoon' | 'evening' {
    if (shift >= 1 && shift <= 6) return 'morning';
    if (shift >= 7 && shift <= 12) return 'afternoon';
    return 'evening';
  }

  async calculateCalendarTableContent(auto: AutoMode = 'none'): Promise<void> {
    try {
      if (auto != 'none') this.loading$.next(true);
      const result: {
        updatedCalendarTableContent: CalendarTableContent;
        updatedCalendarGroupByMajor: CalendarGroupByMajor;
        isConflict: boolean;
      } = await new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL('../workers/calendar.worker', import.meta.url)
        );

        if (auto === this.oldAuto) this.autoTh++;
        else if (auto !== 'none') this.autoTh = 0;
        else this.autoTh = -1;

        worker.onmessage = (res: {
          data: {
            updatedCalendarTableContent: CalendarTableContent;
            updatedCalendarGroupByMajor: CalendarGroupByMajor;
            isConflict: boolean;
          };
        }) => resolve(res.data);
        worker.onerror = (err: any) => reject(err);
        worker.postMessage({
          type: 'calculateCalendarTableContent',
          data: {
            calendarTableContent: this.calendarTableContent$.value,
            calendar: this.calendar$.value,
            sessions: SESSIONS,
            auto,
            autoTh: this.autoTh,
          },
        });
      });

      if (result) {
        this.oldAuto = auto;

        // Cập nhật dữ liệu lịch học sau khi xử lý
        this.calendarTableContent$.next(result.updatedCalendarTableContent);
        const calendar = this.calendar$.value;
        if (calendar) {
          calendar.calendarGroupByMajor = result.updatedCalendarGroupByMajor;
          this.calendar$.next(calendar);
        }
        this.isConflict = result.isConflict;
      }
    } catch (e) {
      alert('Có lỗi xảy ra, không thể cập nhật dữ liệu!');
    } finally {
      if (auto != 'none') this.loading$.next(false);
    }
  }

  triggerRecalculateTableContent(e: Event) {
    const data = e as unknown as {
      major: string;
      subject: string;
      field: 'selectedClass' | 'displayOnCalendar';
      auto: AutoMode;
    };
    this.calculateCalendarTableContent(data.auto);
  }

  resetClass(e: Event): void {
    const major = e as unknown as string;

    const calendar = this.calendar$.value;
    const majorCalendar =
      calendar?.calendarGroupByMajor?.[major] ?? <CalendarGroupByMajor>{};

    const subjects = majorCalendar.subjects as CalendarGroupBySubjectName;
    for (const subjectName in subjects) {
      subjects[subjectName].displayOnCalendar = false;
      subjects[subjectName].selectedClass = '';
    }
  }

  switchTab(tab: 'class-info' | 'calendar' | 'more-info'): void {
    this.showTab = tab;
  }

  print() {
    window.print();
  }
}
