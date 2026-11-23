# AGENTS.md: Hướng dẫn cho agent phát triển

| Mục | Nội dung |
|---|---|
| Dự án | Website nội bộ quản lý thành viên và giao task của CLB (~50 thành viên, 20 ban) |
| Phiên bản | 1.3 (khớp tài liệu HANDOFF v1.3) |
| Áp dụng cho | **Một agent AI duy nhất** làm toàn bộ việc phát triển, **tuần tự từng backlog item** |
| Chủ dự án | Sang. Người quyết định nghiệp vụ, duyệt trước khi merge, thao tác production |

Đây là tệp quy tắc làm việc. Đọc hết trước khi làm bất cứ việc gì. Khi tệp này và tài liệu HANDOFF mâu thuẫn, **HANDOFF thắng**: dừng lại, ghi vào `docs/STATUS.md` và hỏi chủ dự án.

---

## 0. Chín luật bất di bất dịch

1. **Mỗi lúc một item.** Không làm lan sang việc ngoài phạm vi item.
2. **Không đoán nghiệp vụ.** Chỗ nào mơ hồ thì dừng, ghi câu hỏi vào `docs/STATUS.md`, hỏi chủ dự án.
3. **Test trước (hoặc cùng lúc) mã**, bắt nguồn từ tiêu chí chấp nhận (AC) và `docs/openapi.yaml`, không suy từ mã đã viết.
4. **Không chạm production:** không chạy migration lên production, không đổi biến môi trường production, không đọc dữ liệu thật.
5. **Không merge khi chưa được chủ dự án duyệt.**
6. **Không để lộ dữ liệu:** MSSV và email chỉ cho người có `member.view_detail` (và chính chủ); task ẩn không lộ qua bất kỳ đường nào.
7. **Mọi route/server action ghi dữ liệu phải qua `authorize`.** Giao diện ẩn nút chỉ để tiện dùng, không phải kiểm soát quyền.
8. **Đổi `docs/openapi.yaml` hoặc schema CSDL ngoài phạm vi item:** ghi vào `docs/DECISIONS.md` và chờ chủ dự án duyệt.
9. **Tuân thủ nghiêm ngặt kiến trúc và mẫu thiết kế ở mục 6A.** Mã chạy được và test xanh nhưng phá kiến trúc vẫn là **mã chưa đạt**.

## 1. Dự án và công nghệ đã chốt

- **Sản phẩm:** quản lý thành viên; bảng task kiểu Trello (cột, thẻ, kéo thả, giao việc, bình luận) có priority; email nhắc deadline; song ngữ Việt/Anh; đăng nhập bằng MSSV.
- **Nền tảng:** Next.js (React, TypeScript chế độ strict) deploy trên Vercel; PostgreSQL trên Neon; SMTP của email riêng của CLB; Vercel Cron (mỗi ngày một lần); GitHub Actions cho CI.
- **Chưa chốt (hỏi hoặc ghi `DECISIONS.md` rồi chờ duyệt):** ORM (Prisma hoặc Drizzle), thư viện session cụ thể, framework test, thư viện server-state phía giao diện, công cụ kiểm tra kiến trúc.
- **Ngoài MVP, không làm trừ khi item yêu cầu:** nhãn, checklist, file đính kèm, lịch, báo cáo, nhập CSV, RLS PostgreSQL, thông báo trong ứng dụng. **Thiết kế để thêm được sau** (HANDOFF mục 11.9): thay đổi cộng thêm, API chỉ thêm, service tách module.

## 2. Tài liệu nguồn và thứ tự đọc

**Đầu mỗi phiên đọc theo thứ tự:** `AGENTS.md` → `docs/STATUS.md` → item hiện tại trong `docs/BACKLOG.md` → **chỉ các mục HANDOFF ghi trong item**. Không nạp cả tài liệu HANDOFF vào ngữ cảnh.

| Tài liệu | Vai trò | Ai sửa |
|---|---|---|
| `docs/HANDOFF-club-management-website.md` | Nghiệp vụ, kiến trúc, FR/NFR/AC, rủi ro, quyết định | Chỉ chủ dự án (agent đề xuất) |
| `docs/openapi.yaml` | Hợp đồng API | Agent, mỗi thay đổi ghi `DECISIONS.md` và chờ duyệt |
| `wireframes/` | Giao diện cần dựng | Chủ dự án và AI wireframe |
| `docs/BACKLOG.md` | Danh sách item và trạng thái | Agent |
| `docs/STATUS.md` | Trạng thái hiện tại, câu hỏi, việc bị chặn | Agent |
| `docs/DECISIONS.md` | Nhật ký quyết định kỹ thuật | Agent |

**Khi các nguồn mâu thuẫn, thứ tự ưu tiên:** HANDOFF > `openapi.yaml` > wireframe > mô tả item > suy luận của bạn. Không tự chọn một bên: dừng và hỏi.

## 3. Quy trình

### 3.1 Đầu phiên
1. Đọc theo mục 2.
2. Xác nhận item đang làm và trạng thái trong `docs/STATUS.md`; nếu có câu hỏi chủ dự án đã trả lời thì áp dụng.
3. Chạy bộ test hiện có để biết nền xanh hay đỏ trước khi sửa.

### 3.2 Với mỗi backlog item
1. **Ready:** item phải có ID, FR/AC liên quan, phụ thuộc, mục tài liệu cần đọc, phạm vi file, mức rủi ro (mẫu ở mục 9.3). Thiếu thì soạn bổ sung và chờ chủ dự án duyệt trước khi làm.
2. **Kiểm tra phụ thuộc đã xong.** Chưa xong thì không làm item này.
3. **Viết test trước** từ AC và OpenAPI. Mỗi AC có ít nhất một test.
4. **Ghi design note ngắn (mục 6A.7), rồi viết mã trong phạm vi item.** Không sửa file ngoài phạm vi; cần sửa thì ghi lý do và hỏi.
5. **Tự kiểm tra:** chạy test, kiểm tra kiểu, lint; đối chiếu từng AC và ghi AC nào đạt; kiểm tra chuỗi i18n có đủ `vi` và `en`; kiểm tra không lộ MSSV/email/task ẩn; chạy kiểm tra kiến trúc và đối chiếu checklist thiết kế (mục 6A.8).
6. **Mở PR** kèm ghi chú bàn giao (mục 9.1). Item rủi ro cao đánh dấu rõ ở tiêu đề PR.
7. **Chờ chủ dự án duyệt.** Sửa theo phản hồi. **Không merge khi chưa được duyệt.**
8. **Sau khi merge:** cập nhật `docs/BACKLOG.md`, `docs/STATUS.md` (và `docs/DECISIONS.md` nếu có quyết định), rồi mới sang item kế tiếp.

### 3.3 Cuối phiên
Cập nhật `docs/STATUS.md` đủ để phiên sau (không có trí nhớ) làm tiếp được: item đang dở, đã làm gì, còn gì, câu hỏi đang chờ.

## 4. Khi phải dừng và hỏi

Dừng item, ghi `docs/STATUS.md`, hỏi chủ dự án khi gặp **bất kỳ** điều nào sau:

- Nghiệp vụ mơ hồ hoặc tài liệu mâu thuẫn.
- Cần đổi `openapi.yaml` hoặc schema CSDL ngoài phạm vi item.
- Cần thao tác trên production hoặc dữ liệu thật.
- Phát hiện lỗ hổng bảo mật hoặc lỗi nghiệp vụ trong phần đã merge.
- Item quá lớn (vượt khoảng một buổi làm): đề xuất tách thành nhiều item nhỏ.
- **Test không qua sau 3 lần sửa:** dừng và báo cáo, **không** sửa test hay hạ AC cho qua.

## 5. Cấu trúc repo và ranh giới

```
/docs        HANDOFF, openapi.yaml, ERD, BACKLOG.md, STATUS.md, DECISIONS.md
/wireframes  wireframe do AI khác làm (chỉ đọc)
/db          schema, migrations, seed
/messages    vi.json, en.json (chuỗi giao diện và email)
/src/app          trang giao diện và Route Handlers MỎNG (api/v1)
/src/features     mã giao diện theo tính năng (components, hooks, api-client của từng tính năng)
/src/components   thành phần giao diện dùng chung (ui kit)
/src/server/modules  nghiệp vụ theo module: auth, members, departments, permissions, boards, tasks, comments, reminders, audit
/src/server/shared   hạ tầng dùng chung: db, errors, authorize, config, logger, clock, mailer (port + adapter), composition
/src/lib          tiện ích thuần, schema dùng chung
/tests       unit, integration, e2e
AGENTS.md    tệp này
```

| Vùng | Quy tắc |
|---|---|
| `docs/HANDOFF-*.md`, `wireframes/` | Chỉ đọc. Đề xuất thay đổi bằng câu hỏi trong `STATUS.md` |
| `docs/openapi.yaml` | Sửa trong phạm vi item; ghi `DECISIONS.md` và chờ duyệt |
| `docs/BACKLOG.md`, `STATUS.md`, `DECISIONS.md` | Cập nhật sau mỗi item |
| `db/`, `src/`, `messages/`, `tests/` | Sửa trong phạm vi item |
| Production (CSDL, biến môi trường, deploy) | **Cấm.** Chỉ chủ dự án |

## 6. Quy ước mã

- **Ngôn ngữ:** mã, tên biến, commit, PR bằng tiếng Anh; chuỗi giao diện theo `messages/`. *(Mặc định, chủ dự án có thể đổi.)*
- **TypeScript strict;** không dùng `any` trừ khi có lý do ghi chú.
- **Mọi route đi qua lớp service;** không truy vấn CSDL trực tiếp trong route. Tách service theo module (`boards`, `tasks`, `comments`, `members`,...).
- **Kiểm tra dữ liệu vào** bằng schema dùng chung (ví dụ zod) cho cả client và server.
- **Lỗi API thống nhất:** `{ "error": { "code": "...", "messageKey": "...", "details": {} } }`. Mã HTTP: 400 dữ liệu sai, 401 chưa đăng nhập/hết session, 403 thiếu quyền, 404 không có **hoặc không được xem** (kể cả task ẩn), 409 xung đột, 429 vượt giới hạn thử.
- **API chỉ cộng thêm** trong `/api/v1`: không đổi hay xóa trường đã có.
- **i18n:** không viết cứng chuỗi trong component; mọi chuỗi mới có **cả `vi` và `en`**. Email nhắc gửi theo `profiles.locale` của người nhận.
- **Dữ liệu:** khóa chính UUID; thời gian lưu UTC (`timestamptz`), hiển thị theo `Asia/Ho_Chi_Minh`; `tasks.priority` là số 1–4 (1 Thấp, 2 Trung bình mặc định, 3 Cao, 4 Khẩn).
- **Nhánh và commit:** nhánh `feat/<ID>-<mô-tả-ngắn>` (ví dụ `feat/E5-03-create-task-api`); commit `<ID>: <mô tả ngắn>`.
- **Migration:** chỉ cộng thêm, chạy lại được, không sửa migration đã merge.

## 6A. Thiết kế phần mềm (bắt buộc)

Mục tiêu: mã **bảo trì được** và **mở rộng được** (thêm nhãn, checklist, đính kèm, báo cáo,... mà không viết lại), nhưng **không over-engineering** (quy mô chỉ ~50 người). Chủ dự án từ chối PR vi phạm mục này, kể cả khi test xanh.

### 6A.1 Nguyên tắc nền (áp dụng cho mọi mã)
- **SOLID:** một lý do thay đổi cho mỗi đơn vị (SRP); mở rộng bằng cách thêm mã thay vì sửa nhiều chỗ (OCP); interface nhỏ, tập trung (ISP); module nghiệp vụ phụ thuộc interface chứ không phụ thuộc chi tiết hạ tầng (DIP).
- **Tách mối quan tâm,** cohesion cao, coupling thấp; **ưu tiên composition hơn kế thừa.**
- **DRY có kiểm soát:** lặp lần thứ ba mới trừu tượng hóa (mục 6A.9). **KISS, YAGNI:** không xây thứ chưa cần.
- **Một nguồn sự thật cho mỗi tri thức** (ví dụ danh mục quyền, hằng số cấu hình, điều kiện task ẩn).
- **Bất biến mặc định;** hàm thuần khi có thể; không biến toàn cục thay đổi được; không side effect ẩn.
- **Đặt tên theo miền nghiệp vụ** (`Task`, `Board`, `Permission`), không đặt tên mơ hồ (`data`, `manager`, `helper`, `utils`).

### 6A.2 Kiến trúc phân lớp và hướng phụ thuộc
Từ ngoài vào trong:
1. **Delivery** (`src/app/api`, cron): **mỏng.** Chỉ đọc request, gọi service, ánh xạ phản hồi và lỗi. **Không chứa nghiệp vụ.**
2. **Service / use case** (`src/server/modules/<module>/`): nghiệp vụ, gọi `authorize`, mở transaction.
3. **Domain / policy:** quy tắc nghiệp vụ thuần (ví dụ ai xem được task ẩn), không biết DB hay HTTP.
4. **Repository (port) và adapter:** truy cập dữ liệu; service chỉ biết interface.
5. **Hạ tầng** (`src/server/shared`): db client, mailer, clock, logger, config.

**Quy tắc phụ thuộc:** chỉ phụ thuộc vào trong. **Cấm:** service/domain import từ `src/app`, React hoặc thư viện HTTP; module này import tệp nội bộ của module khác (chỉ dùng API công khai qua `index.ts`); vòng phụ thuộc.

### 6A.3 Ranh giới bắt buộc (port và adapter)
Luôn có interface cho các ranh giới sau, kể cả khi mới có một cài đặt. Ngoài danh sách này **không** tạo interface "cho chắc".

| Ranh giới | Port (interface) | Adapter hiện tại | Lý do |
|---|---|---|---|
| Dữ liệu | `<Aggregate>Repository` | ORM trên PostgreSQL (Neon) | Đổi ORM/nhà cung cấp, test bằng bản giả |
| Gửi email | `Mailer` | SMTP của email CLB | Đổi sang Resend/Brevo khi cần |
| Thời gian | `Clock` | Đồng hồ hệ thống | Test hạn, nhắc, session ổn định |
| Ghi log | `Logger` | Log có cấu trúc | Bảo đảm không ghi PII |
| Cấu hình | `Config` | Biến môi trường, kiểm tra một lần lúc khởi động | Lỗi cấu hình phát hiện sớm |

### 6A.4 Mẫu thiết kế bắt buộc và nơi dùng

| Mẫu | Dùng ở đâu | Cách dùng |
|---|---|---|
| Service Layer | Mọi use case | Một hàm/lớp cho một use case (ví dụ `createTask`); không đặt nghiệp vụ trong route hay component |
| Repository | Truy cập dữ liệu | Không viết SQL/ORM ngoài repository; trả về đối tượng miền hoặc DTO, không lộ entity của ORM |
| Policy (specification) | Quyền, khả năng xem | Ví dụ `taskVisibilityPolicy`, `canToggleHidden`; **một nguồn duy nhất** cho điều kiện task ẩn, dùng ở mọi list/search/count/chi tiết |
| Registry dữ liệu | Danh mục quyền, mốc nhắc | Mảng hằng `PERMISSIONS` là nguồn duy nhất sinh kiểu, seed và giao diện; thêm quyền = thêm một dòng |
| Dependency Injection thủ công | Service nhận hạ tầng qua tham số | Một composition root (`src/server/shared/composition.ts`) ráp mọi thứ; không `new` hạ tầng trong service; không cần framework DI |
| Adapter | `Mailer`, repository, `Clock` | Cài đặt các port ở mục 6A.3 |
| DTO và Mapper | Ranh giới API | Ánh xạ miền sang DTO ở **một chỗ**; **mapper là nơi ẩn MSSV/email** theo quyền người xem; không trả entity DB ra API |
| Typed errors | Lỗi nghiệp vụ | `AppError` (code, messageKey, httpStatus) và bộ ánh xạ lỗi tập trung trong wrapper handler; không `throw new Error("chuỗi")`; không nuốt lỗi |
| Transaction boundary | Thao tác nhiều bước | Service mở transaction qua `TransactionRunner` (ví dụ đổi quyền kèm ghi audit; gỡ admin cuối cùng) |
| Command (apply/invert) + Registry | Thao tác task hoàn tác được | Mỗi loại sự kiện đăng ký một command có `apply` và `invert` kèm quyền cần có; thêm loại mới chỉ cần đăng ký thêm, không sửa nơi khác |
| Strategy, Factory | Khi có từ 2 biến thể thật | Ví dụ mẫu quyền (preset), dựng email theo locale; không dùng khi chỉ có một biến thể |
| Job idempotent | Cron nhắc deadline | Chạy lại không gửi trùng (unique trong `reminders`) |

**Giao diện (frontend)**
- **Theo tính năng:** mã nằm trong `src/features/<feature>`; component dùng chung ở `src/components`.
- **Tách trình bày và logic:** component thuần nhận props; logic gọi API và trạng thái ở hook (ví dụ `useTasks`). Không nghiệp vụ trong JSX.
- **API client tập trung,** sinh kiểu từ `openapi.yaml`; không `fetch` rải rác trong component.
- **Một cách duy nhất** cho server state (thư viện chọn một lần, ghi `DECISIONS.md`) và cho form (schema dùng chung với server).
- **Composition cho UI phức tạp** (ví dụ Kanban bằng các component ghép); không truyền props qua quá 2 cấp (dùng context hoặc hook).
- **Ẩn/hiện theo quyền** qua một điểm duy nhất (ví dụ hook `usePermissions` hoặc `<Can>`); chỉ để tiện dùng, server vẫn kiểm tra.
- **i18n:** mọi chuỗi qua `messages/` và hook dịch; không chuỗi cứng.

### 6A.5 Cách thêm tính năng mới (để mở rộng đúng cách)
Ví dụ thêm checklist cho task. Làm đúng thứ tự, **không sửa logic của module khác** ngoài điểm nối công khai:
1. Migration cộng thêm bảng mới.
2. Module mới `src/server/modules/checklists/` đủ `repository`, `service`, `policy`, `schemas`, `mapper`, `index.ts`.
3. Thêm mã quyền vào `PERMISSIONS` (kèm migration seed và test).
4. Thêm endpoint vào `openapi.yaml` (chỉ thêm, không đổi cái đã có).
5. Route mỏng gọi service.
6. Mã giao diện trong `src/features/checklists`.
7. Chuỗi `vi` và `en`.
8. Test cho policy, service (bản giả) và repository (CSDL test).

### 6A.6 Chất lượng mã (ngưỡng mặc định, cấu hình trong lint)
- Hàm tối đa khoảng 40 dòng; tệp tối đa khoảng 300 dòng; tham số tối đa 3–4 (dùng object có tên); độ phức tạp vòng tối đa 10; lồng tối đa 3 cấp; dùng early return.
- Không `any`; không mã chết hay đoạn mã cũ bị comment; không magic number/string (dùng hằng có tên); không viết tắt khó hiểu. Comment giải thích **vì sao**, không giải thích mã làm gì.
- **Xử lý lỗi:** kiểm tra dữ liệu tại ranh giới bằng schema; bất biến nghiệp vụ kiểm tra trong service; không bắt lỗi rồi bỏ qua; không dùng exception cho luồng bình thường.
- **Hiệu năng hợp lý:** tránh truy vấn N+1 (dùng truy vấn gộp), phân trang, chỉ mục theo HANDOFF mục 11.4; không tối ưu sớm.
- **An toàn ghi dữ liệu:** thao tác nhiều bước dùng transaction; thao tác dễ tranh chấp (kéo thả, gỡ admin) dùng cập nhật có điều kiện hoặc khóa dòng.
- **Bảo mật theo thiết kế:** đặc quyền tối thiểu, không tin dữ liệu từ client, log có cấu trúc và không PII.

### 6A.7 Design note (bắt buộc trước khi viết mã)
Với mọi item trừ item rất nhỏ (sửa chuỗi, sửa lỗi một dòng), ghi 5–10 dòng vào mô tả PR (và `docs/STATUS.md` nếu item dài) **trước khi code**:

```
Design note: E5-03
Chạm: module tasks (service, repository, policy), route POST /tasks
Port/interface: dùng TaskRepository, Clock; không thêm mới
Mẫu áp dụng: Service Layer + Policy (taskVisibilityPolicy) + Mapper (taskToDto, ẩn PII)
Điểm mở rộng giữ lại: mapper và schema dễ thêm trường mới
Quyết định: <chọn X thay vì Y> vì ...
Phụ thuộc mới: không (nếu có: ghi DECISIONS.md và chờ duyệt)
```

### 6A.8 Checklist thiết kế (tự kiểm tra trước khi mở PR)
Ghi kết quả trong ghi chú bàn giao (mục 9.1). Mục nào không đạt phải nêu lý do.
- [ ] Route/handler mỏng, không chứa nghiệp vụ.
- [ ] Nghiệp vụ nằm trong service/policy, không nằm trong route hay React component.
- [ ] Mọi truy cập dữ liệu qua repository; không có SQL/ORM ngoài repository.
- [ ] Service nhận hạ tầng qua tham số (DI), không `new` hay import trực tiếp hạ tầng; test được bằng bản giả.
- [ ] Hướng phụ thuộc đúng mục 6A.2; không import chéo vào nội bộ module khác; không vòng phụ thuộc.
- [ ] Không lặp điều kiện nghiệp vụ (nhất là quyền, task ẩn, ẩn MSSV): dùng policy/mapper chung.
- [ ] Không trả entity DB ra API; DTO qua mapper; không lộ MSSV/email.
- [ ] Lỗi dùng `AppError`; không nuốt lỗi.
- [ ] Không magic string/number; mã quyền lấy từ `PERMISSIONS`.
- [ ] Thay đổi chỉ cộng thêm (migration, API); không phá cái đã có.
- [ ] Không thêm trừu tượng hay thư viện thừa; mỗi trừu tượng/thư viện mới có lý do ghi trong design note.
- [ ] Hàm và tệp trong ngưỡng mục 6A.6; lint và kiểm tra kiến trúc sạch.
- [ ] Có test cho policy và service bằng bản giả (không cần DB thật) và test tích hợp cho repository.

### 6A.9 Chống over-engineering
- Chỉ dùng mẫu khi giải quyết vấn đề thật nêu ở mục 6A.4; không thêm mẫu "cho đẹp".
- **Quy tắc ba:** trừu tượng hóa khi lặp lần thứ ba. Ngoại lệ duy nhất cho việc tạo interface sớm là các ranh giới ở mục 6A.3.
- Không thêm framework/thư viện nếu thư viện đã chọn làm được; thư viện mới phải ghi `DECISIONS.md` và chờ duyệt.
- **Không làm trong MVP:** event bus, CQRS, microservice, DDD đầy đủ, hệ thống plugin, framework DI.

### 6A.10 Thực thi bằng công cụ
Thiết lập ở Epic E1 và giữ trong CI:
- Kiểm tra kiến trúc: cấm import trái hướng và vòng phụ thuộc (ví dụ dependency-cruiser hoặc ESLint `no-restricted-imports`/boundaries).
- ESLint cho độ phức tạp, kích thước hàm, `no-explicit-any`; TypeScript strict.
- CI chặn merge khi vi phạm. **Không tắt quy tắc** (`eslint-disable`) để qua; nếu thật sự cần thì ghi lý do trong PR và chờ duyệt.

## 7. Quy tắc bảo mật và nghiệp vụ (không được vi phạm)

**Danh tính và hiển thị**
- MSSV và email chỉ hiện cho người có `member.view_detail` và cho **chính chủ** ở hồ sơ cá nhân. Ở mọi nơi khác (người được giao, người bình luận, người tạo, danh sách thành viên) chỉ hiện **họ tên**; thành viên đã rời hiện "(đã rời)".
- **Không ghi MSSV/email vào log.** Không đưa MSSV vào email nhắc, URL hay thông báo lỗi.
- Email thành viên phải thuộc tên miền `@eiu.edu.vn` (cấu hình được); kiểm tra ở server khi tạo/sửa.

**Task ẩn**
- Task có `is_hidden` chỉ hiển thị cho **người được giao, người tạo và admin**.
- Lọc ở **mọi** truy vấn danh sách, tìm kiếm, đếm, API chi tiết, bình luận, lịch sử task, email nhắc, dữ liệu xuất, không chỉ ở giao diện. Người không được xem nhận 404.
- Chỉ **người tạo task và admin** bật/tắt cờ ẩn. `task.update_any` không cho phép xem hoặc sửa task ẩn mà mình không được xem.

**Quyền**
- `authorize(user, permission, resource?)` đúng khi tài khoản `is_active` và (là `is_admin` hoặc có dòng `user_permissions` khớp). Quyền áp dụng **toàn CLB**, vĩnh viễn, không phạm vi theo ban, không hết hạn.
- **Đọc quyền từ database ở mỗi request;** không nhúng quyền vào cookie/token session.
- Admin vượt mọi kiểm tra quyền, nhưng **nhật ký quản trị chỉ ghi thêm**, không sửa/xóa, kể cả với admin.
- Chỉ admin ghi `user_permissions` và `profiles.is_admin`. Quy tắc **luôn còn ít nhất một admin hoạt động** được bảo đảm bằng trigger/ràng buộc ở CSDL kèm kiểm tra trong transaction.
- Mọi thay đổi quyền ghi một bản `audit_logs` (ai, khi nào, cho ai, quyền nào).
- Tài khoản mới mặc định có `member.view`, `task.update_assigned`, `comment.create`.

**Đăng nhập và session**
- Đăng nhập **chỉ bằng MSSV** (admin đăng ký trước), không mật khẩu, không OTP. Thông báo lỗi **chung**, không cho biết MSSV có tồn tại hay bị khóa.
- Giới hạn nhẹ số lần thử theo IP và ghi `login_attempts`.
- Màn hình đăng nhập có ô **"Ghi nhớ đăng nhập"** (mặc định **không tích**, kèm dòng nhắc "Chỉ tích trên thiết bị của bạn"). **Không tích:** cookie phiên (mất khi đóng trình duyệt) kèm hạn tối đa phía server `SESSION_TTL_DEFAULT` (mặc định 24 giờ). **Tích:** sống `SESSION_TTL_REMEMBER` (mặc định 30 ngày, gia hạn khi dùng). Hai giá trị là cấu hình tập trung, không viết cứng rải rác.
- Cookie `HttpOnly`, `Secure`, `SameSite`. Hết hạn thì về màn hình đăng nhập kèm thông báo; **không** có hộp nhập lại MSSV giữa trang. Dùng thư viện đã được kiểm chứng, **không tự chế mật mã**. Mỗi request vẫn đọc lại `is_active` và quyền từ database.

**Lịch sử và hoàn tác** *(HANDOFF mục 8.8; phương án công nghệ chờ xác nhận Q36, mặc định là event log ở tầng ứng dụng)*
- Mọi thay đổi task ghi một bản `task_events` **trong cùng transaction**, do **service** thực hiện (không ghi ở route, không dùng trigger). Chỉ ghi khi có thay đổi thật.
- `task_events` **chỉ ghi thêm:** không `UPDATE`/`DELETE`, kể cả admin. Chỉ lưu **id** (người, cột, người được giao), **không lưu tên, MSSV, email**; tên hiển thị giải mã khi đọc qua mapper.
- Lịch sử tuân theo **cùng policy xem task** (task ẩn: 404 cho người không được phép) và cùng mapper ẩn MSSV/email.
- **Hoàn tác = sự kiện mới** (`reverts_event_id`), không xóa sự kiện cũ. Kiểm tra **quyền của thao tác gốc** và **xung đột** (so giá trị hiện tại với `to`; khác thì 409; chỉ `force=true` khi người dùng xác nhận, ghi `forced=true`). Dùng `tasks.version` để chặn ghi đè do tranh chấp.
- Hoàn tác được: sửa trường, đổi cột/vị trí, đổi người được giao, bật/tắt ẩn, xóa/khôi phục. **Không** hoàn tác: bình luận, thao tác quản trị (`audit_logs`).
- Xóa task là **xóa mềm** (`deleted_at`); mọi truy vấn thường lọc `deleted_at IS NULL`; chỉ Thùng rác của board thấy task đã xóa. Không xóa vĩnh viễn trong MVP.

**Thành viên**
- Thành viên rời CLB: `is_active=false`, ghi `left_at`; **không xóa cứng** dữ liệu và task của họ; không nhận nhắc deadline; không đăng nhập được.
- Nhập thành viên bằng tay qua trang quản trị. Không làm tính năng nhập CSV.

**Nhắc deadline**
- Mốc nhắc do admin cấu hình, lưu trong `app_settings`. Mặc định: còn 2 ngày, còn 1 ngày, quá hạn; giờ gửi cố định 07:00 giờ Việt Nam (Vercel Cron gói free chỉ chạy theo ngày).
- Một email mỗi người (gộp nhiều task), theo ngôn ngữ người nhận; không gửi trùng (bảng `reminders` có unique `(task_id, user_id, kind)`). Task ở cột cuối (Done) không nhắc.
- Endpoint cron bảo vệ bằng secret, không công khai.

**Chung**
- Không commit bí mật (chuỗi kết nối CSDL, mật khẩu SMTP, khóa ký session): dùng biến môi trường.
- Dữ liệu dev/preview/test là **dữ liệu giả**, không dùng MSSV/email thật.
- Cơ sở dữ liệu không bao giờ được truy cập trực tiếp từ trình duyệt.

## 8. Test và chất lượng

- Test bắt nguồn từ **AC và `openapi.yaml`**, không suy kỳ vọng từ mã. Chủ dự án review test như review mã.
- **Mỗi mã quyền có ít nhất một test "được" và một test "không được".**
- Bắt buộc có test cho: task ẩn (người được phép và người không được phép), ẩn MSSV/email, luồng đăng nhập (đúng, MSSV lạ, tài khoản khóa, vượt giới hạn thử), hạn session ở hai chế độ (có/không tích Ghi nhớ đăng nhập), gỡ admin cuối cùng, ghi lịch sử task và hoàn tác (quyền, xung đột 409, task ẩn, chỉ ghi thêm), nhắc deadline không gửi trùng, i18n đủ khóa `vi`/`en`.
- Test dùng CSDL test riêng và dữ liệu seed giả; không đụng CSDL production.
- Policy và service được test bằng bản giả (repository, clock, mailer giả) không cần DB thật; repository có test tích hợp với CSDL test.
- CI (GitHub Actions) chạy kiểm tra kiểu, lint, test, kiểm tra mã khớp `openapi.yaml`; không merge khi một bước lỗi.
- Item **xong** khi: test qua, kiểm tra kiểu/lint sạch, các AC của item đạt, chủ dự án duyệt, tài liệu và `docs/STATUS.md` đã cập nhật.

### Item rủi ro cao
Gồm: xác thực/session, `authorize`, lọc task ẩn, ẩn MSSV/email, lịch sử và hoàn tác, cron gửi mail, migration, cấu hình production. Với các item này:
- Bắt buộc có test tự động đầy đủ trước khi nhờ duyệt.
- Ghi rõ "RỦI RO CAO" ở PR và liệt kê các kịch bản đã kiểm tra.
- Đề nghị chủ dự án cho **một phiên mới (ngữ cảnh sạch) review diff**, vì phiên đã viết mã khó thấy lỗi của chính mình.

## 9. Mẫu

### 9.1 Ghi chú bàn giao (trong PR)
```
Item: E5-03   [RỦI RO CAO nếu có]
Đã làm: ...
File thay đổi: ...
Cách chạy và kiểm tra: ...
AC đã đạt / chưa đạt: ...
Design note: ... (hoặc "item rất nhỏ")
Checklist thiết kế (6A.8): đạt / mục không đạt và lý do: ...
Giả định đã dùng: ...
Câu hỏi cần bạn trả lời: ...
```

### 9.2 Mục trong `docs/STATUS.md`
```
# STATUS
Cập nhật: <ngày> · Phiên: <số>
Epic hiện tại: E5 · Item đang làm: E5-03 · Trạng thái: In progress
Đã xong gần đây: ...
Đang bị chặn / câu hỏi cho chủ dự án: ...
Việc tiếp theo: ...
```

### 9.3 Backlog item
```
ID: E5-03
Tiêu đề: API tạo task
Liên quan: FR-21, AC-06, mục 11.5 (POST /tasks)
Phụ thuộc: E4-02 (authorize)
Mục tài liệu cần đọc: 3.3, 8.6, 11.5
Phạm vi file được sửa: src/app/api/v1/tasks/route.ts, src/server/tasks.ts
Tiêu chí chấp nhận: Cho/Khi/Thì (lấy từ AC liên quan)
Kiểm thử bắt buộc (viết trước): ...
Ngoài phạm vi: ...
Design note (agent điền trước khi code): ...
Mức rủi ro: thường / cao
Trạng thái: Backlog / Ready / In progress / Chờ duyệt / Done
```

### 9.4 Mục trong `docs/DECISIONS.md`
```
## <ngày> · <tiêu đề quyết định>
Bối cảnh: ...
Đề xuất / quyết định: ...
Ảnh hưởng (openapi, schema, tài liệu): ...
Trạng thái: Chờ duyệt / Đã duyệt bởi chủ dự án
```

## 10. Lệnh chuẩn

*Chủ dự án hoặc agent điền khi hoàn thành Epic E1 (nền tảng), rồi giữ cập nhật. Chưa điền thì hỏi, không đoán.*

| Việc | Lệnh |
|---|---|
| Cài phụ thuộc | `<điền>` |
| Chạy dev | `<điền>` |
| Kiểm tra kiểu | `<điền>` |
| Lint | `<điền>` |
| Chạy toàn bộ test | `<điền>` |
| Chạy một file test | `<điền>` |
| Tạo/áp migration (dev) | `<điền>` |
| Nạp dữ liệu seed (dev) | `<điền>` |
| Kiểm tra khớp OpenAPI | `<điền>` |
| Kiểm tra kiến trúc (hướng phụ thuộc, vòng phụ thuộc) | `<điền>` |

## 11. Điều cấm (tóm tắt)

- Chạm production; đọc dữ liệu thật; commit bí mật.
- Merge khi chưa được duyệt.
- Làm nhiều item cùng lúc hoặc làm ngoài phạm vi item.
- Đoán nghiệp vụ; sửa tài liệu HANDOFF.
- Sửa test hoặc hạ AC để test qua.
- Hiển thị MSSV/email sai quy tắc; để task ẩn lộ ra ngoài.
- Bỏ qua `authorize`, hoặc coi việc ẩn nút trên giao diện là kiểm soát quyền.
- Đặt nghiệp vụ trong route hoặc React component; truy cập DB ngoài repository; import chéo vào nội bộ module khác; trả entity DB ra API; viết lại điều kiện quyền/task ẩn ở nhiều chỗ; thêm trừu tượng hoặc thư viện chưa có lý do (mục 6A).
- Tự chế mã hóa/xác thực; ghi PII vào log.
- Thêm tính năng ngoài MVP (nhãn, checklist, đính kèm, lịch, báo cáo, nhập CSV, RLS) khi item không yêu cầu.

## Phụ lục A. Danh mục 18 quyền

| Nhóm | Mã quyền | Ý nghĩa |
|---|---|---|
| Thành viên | `member.view` | Xem danh sách thành viên (họ tên, ban) |
| Thành viên | `member.view_detail` | Xem MSSV, email |
| Thành viên | `member.create` | Thêm thành viên |
| Thành viên | `member.update` | Sửa hồ sơ, gán ban |
| Thành viên | `member.deactivate` | Khóa/mở khóa tài khoản |
| Ban | `department.manage` | Tạo/sửa/xóa ban |
| Board | `board.create` | Tạo board |
| Board | `board.update` | Sửa board, quản lý cột |
| Board | `board.delete` | Lưu trữ/xóa board |
| Task | `task.create` | Tạo task |
| Task | `task.assign` | Giao/bỏ giao người nhận |
| Task | `task.update_any` | Sửa, di chuyển mọi task |
| Task | `task.update_assigned` | Sửa, di chuyển task được giao cho mình |
| Task | `task.delete` | Xóa task |
| Bình luận | `comment.create` | Bình luận |
| Bình luận | `comment.delete_any` | Xóa bình luận của người khác |
| Hệ thống | `reminder.configure` | Cấu hình mốc nhắc deadline |
| Hệ thống | `audit.view` | Xem nhật ký quản trị |

Ngoài danh mục: **xem mọi task không ẩn** (mọi tài khoản hoạt động), **bật/tắt cờ ẩn** (người tạo task và admin), **cấp/thu hồi quyền và cờ admin** (chỉ admin).
