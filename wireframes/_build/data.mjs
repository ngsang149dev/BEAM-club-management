// Sample data for the wireframe set. All people, IDs and addresses are fabricated.

export const members = {
  A: { key: 'A', name: 'Nguyễn Văn A', mssv: 'MSSV-001', email: 'nguyenvana@eiu.edu.vn', depts: ['Truyền thông', 'Sự kiện'], active: true, admin: false, roleVi: 'Thành viên', roleEn: 'Member' },
  B: { key: 'B', name: 'Trần Thị B', mssv: 'MSSV-002', email: 'tranthib@eiu.edu.vn', depts: ['Học thuật'], active: true, admin: true, roleVi: 'Admin', roleEn: 'Admin' },
  C: { key: 'C', name: 'Lê Văn C', mssv: 'MSSV-003', email: 'levanc@eiu.edu.vn', depts: ['Sự kiện'], active: true, admin: false, roleVi: 'Trưởng ban', roleEn: 'Department lead' },
  D: { key: 'D', name: 'Phạm Minh D', mssv: 'MSSV-004', email: 'phamminhd@eiu.edu.vn', depts: ['Nhân sự', 'Đối ngoại'], active: true, admin: true, roleVi: 'Admin', roleEn: 'Admin' },
  E: { key: 'E', name: 'Hoàng Thị E', mssv: 'MSSV-005', email: 'hoangthie@eiu.edu.vn', depts: ['Truyền thông'], active: true, admin: false, roleVi: 'Thành viên', roleEn: 'Member' },
  F: { key: 'F', name: 'Vũ Quốc F', mssv: 'MSSV-006', email: 'vuquocf@eiu.edu.vn', depts: ['Học thuật'], active: false, admin: false, roleVi: 'Đã rời CLB', roleEn: 'Left the club' },
  G: { key: 'G', name: 'Đỗ Thị G', mssv: 'MSSV-007', email: 'dothig@eiu.edu.vn', depts: ['Sự kiện'], active: true, admin: false, roleVi: 'Thành viên', roleEn: 'Member' },
  H: { key: 'H', name: 'Bùi Văn H', mssv: 'MSSV-008', email: 'buivanh@eiu.edu.vn', depts: ['Đối ngoại'], active: true, admin: false, roleVi: 'Thành viên', roleEn: 'Member' },
  I: { key: 'I', name: 'Ngô Thị I', mssv: 'MSSV-009', email: 'ngothii@eiu.edu.vn', depts: ['Nhân sự'], active: true, admin: false, roleVi: 'Thành viên', roleEn: 'Member' },
  K: { key: 'K', name: 'Dương Văn K', mssv: 'MSSV-010', email: 'duongvank@eiu.edu.vn', depts: ['Học thuật'], active: true, admin: false, roleVi: 'Thành viên', roleEn: 'Member' }
};

export const memberList = Object.values(members);

export const departments = [
  { name: 'Sự kiện', members: 3, boards: 2 },
  { name: 'Truyền thông', members: 2, boards: 1 },
  { name: 'Học thuật', members: 2, boards: 1 },
  { name: 'Nhân sự', members: 2, boards: 1 },
  { name: 'Đối ngoại', members: 2, boards: 1 },
  { name: 'Tài chính', members: 1, boards: 0 },
  { name: 'Kỹ thuật', members: 1, boards: 1 },
  { name: 'Thiết kế', members: 1, boards: 0 },
  { name: 'Hậu cần', members: 1, boards: 0 },
  { name: 'Văn nghệ', members: 1, boards: 0 },
  { name: 'Thể thao', members: 0, boards: 0 },
  { name: 'Tình nguyện', members: 0, boards: 0 },
  { name: 'Công nghệ', members: 0, boards: 0 },
  { name: 'Nội dung', members: 0, boards: 0 },
  { name: 'Quan hệ cựu thành viên', members: 0, boards: 0 },
  { name: 'Pháp lý', members: 0, boards: 0 },
  { name: 'Y tế', members: 0, boards: 0 },
  { name: 'Điều phối', members: 0, boards: 0 },
  { name: 'Sáng tạo', members: 0, boards: 0 },
  { name: 'Đào tạo', members: 0, boards: 0 }
];

export const boards = [
  { name: 'Sự kiện Open Day 2026', dept: 'Sự kiện', open: 12, overdue: 1, updatedVi: '2 giờ trước', updatedEn: '2 hours ago' },
  { name: 'Truyền thông tuyển thành viên', dept: 'Truyền thông', open: 8, overdue: 0, updatedVi: 'Hôm qua', updatedEn: 'Yesterday' },
  { name: 'Kế hoạch học thuật HK2', dept: 'Học thuật', open: 5, overdue: 0, updatedVi: '3 ngày trước', updatedEn: '3 days ago' },
  { name: 'Đối ngoại — đối tác 2026', dept: 'Đối ngoại', open: 6, overdue: 2, updatedVi: '4 ngày trước', updatedEn: '4 days ago' },
  { name: 'Nhân sự — onboarding', dept: 'Nhân sự', open: 4, overdue: 0, updatedVi: '5 ngày trước', updatedEn: '5 days ago' },
  { name: 'Vận hành CLB', dept: null, open: 9, overdue: 0, updatedVi: '1 tuần trước', updatedEn: '1 week ago' }
];

export const tasks = {
  sponsor: { id: 't1', title: 'Chốt danh sách nhà tài trợ', priority: 3, due: { vi: '26/11', en: '26 Nov', state: 'soon' }, assignees: ['A', 'C'], comments: 3, hidden: false },
  standee: { id: 't2', title: 'Thiết kế standee sân khấu', priority: 2, due: { vi: '28/11', en: '28 Nov', state: 'normal' }, assignees: ['E'], comments: 1, hidden: false },
  audio: { id: 't3', title: 'Mượn thiết bị âm thanh', priority: 1, due: null, assignees: ['G'], comments: 0, hidden: false },
  script: { id: 't4', title: 'Viết kịch bản MC', priority: 4, due: { vi: 'Hôm nay', en: 'Today', state: 'today' }, assignees: ['A', 'D'], comments: 5, hidden: false },
  slide: { id: 't5', title: 'Chuẩn bị slide giới thiệu CLB', priority: 4, due: { vi: 'Quá hạn 1 ngày', en: '1 day overdue', state: 'overdue' }, assignees: ['A'], comments: 2, hidden: true },
  catering: { id: 't6', title: 'Đặt catering cho 120 khách', priority: 3, due: { vi: 'Còn 2 ngày', en: '2 days left', state: 'soon' }, assignees: ['D', 'G'], comments: 4, hidden: false },
  guests: { id: 't7', title: 'Duyệt danh sách khách mời', priority: 2, due: { vi: 'Còn 1 ngày', en: '1 day left', state: 'soon' }, assignees: ['E'], comments: 0, hidden: false },
  poster: { id: 't8', title: 'Hoàn thiện poster A3', priority: 3, due: { vi: 'Còn 1 ngày', en: '1 day left', state: 'soon' }, assignees: ['E', 'D'], comments: 6, hidden: false },
  opening: { id: 't9', title: 'Kịch bản khai mạc', priority: 2, due: { vi: '26/11', en: '26 Nov', state: 'normal' }, assignees: ['C', 'F'], comments: 2, hidden: false },
  theme: { id: 't10', title: 'Lên ý tưởng chủ đề Open Day', priority: 2, due: { vi: '20/11', en: '20 Nov', state: 'done' }, assignees: ['A', 'C'], comments: 8, hidden: false },
  invitations: { id: 't11', title: 'Gửi thư mời các CLB', priority: 1, due: { vi: '19/11', en: '19 Nov', state: 'done' }, assignees: ['D'], comments: 1, hidden: false },
  venue: { id: 't12', title: 'Chốt địa điểm tổ chức', priority: 3, due: { vi: '18/11', en: '18 Nov', state: 'done' }, assignees: ['C'], comments: 3, hidden: false }
};

export const columns = [
  { key: 'todo', nameVi: 'Cần làm', nameEn: 'To do', tasks: ['sponsor', 'standee', 'audio'] },
  { key: 'doing', nameVi: 'Đang làm', nameEn: 'In progress', tasks: ['script', 'slide', 'catering', 'guests'] },
  { key: 'review', nameVi: 'Chờ duyệt', nameEn: 'Review', tasks: ['poster', 'opening'] },
  { key: 'done', nameVi: 'Hoàn thành', nameEn: 'Done', tasks: ['theme', 'invitations', 'venue'] }
];

export const myTasks = [
  { task: tasks.slide, boardVi: 'Sự kiện Open Day 2026', boardEn: 'Sự kiện Open Day 2026', columnVi: 'Đang làm', columnEn: 'In progress', group: 'overdue' },
  { task: tasks.script, boardVi: 'Sự kiện Open Day 2026', boardEn: 'Sự kiện Open Day 2026', columnVi: 'Đang làm', columnEn: 'In progress', group: 'today' },
  { task: tasks.sponsor, boardVi: 'Sự kiện Open Day 2026', boardEn: 'Sự kiện Open Day 2026', columnVi: 'Cần làm', columnEn: 'To do', group: 'week' },
  { task: { id: 'm4', title: 'Chuẩn bị bài đăng tuyển thành viên', priority: 2, due: { vi: '24/11', en: '24 Nov', state: 'soon' }, assignees: ['A'], comments: 1, hidden: false }, boardVi: 'Truyền thông tuyển thành viên', boardEn: 'Truyền thông tuyển thành viên', columnVi: 'Chờ duyệt', columnEn: 'Review', group: 'week' },
  { task: { id: 'm5', title: 'Tổng hợp danh sách ứng viên', priority: 3, due: { vi: '27/11', en: '27 Nov', state: 'normal' }, assignees: ['A'], comments: 2, hidden: false }, boardVi: 'Nhân sự — onboarding', boardEn: 'Nhân sự — onboarding', columnVi: 'Đang làm', columnEn: 'In progress', group: 'week' },
  { task: { id: 'm6', title: 'Thiết kế banner tổng kết năm', priority: 1, due: { vi: '05/12', en: '5 Dec', state: 'normal' }, assignees: ['A'], comments: 0, hidden: false }, boardVi: 'Truyền thông tuyển thành viên', boardEn: 'Truyền thông tuyển thành viên', columnVi: 'Cần làm', columnEn: 'To do', group: 'later' },
  { task: { id: 'm7', title: 'Cập nhật trang giới thiệu CLB', priority: 1, due: null, assignees: ['A'], comments: 0, hidden: false }, boardVi: 'Vận hành CLB', boardEn: 'Vận hành CLB', columnVi: 'Cần làm', columnEn: 'To do', group: 'none' }
];

export const permissionGroups = [
  {
    key: 'member', nameVi: 'Thành viên', nameEn: 'Members',
    items: [
      { code: 'member.view', vi: 'Xem danh sách thành viên, họ tên và ban', en: 'See members, names and departments' },
      { code: 'member.view_detail', vi: 'Xem MSSV và email của thành viên', en: 'See student IDs and email addresses' },
      { code: 'member.create', vi: 'Thêm tài khoản thành viên mới', en: 'Add member accounts' },
      { code: 'member.update', vi: 'Sửa hồ sơ và gán ban', en: 'Edit profiles and assign departments' },
      { code: 'member.deactivate', vi: 'Khóa hoặc mở khóa tài khoản', en: 'Deactivate or reactivate accounts' }
    ]
  },
  {
    key: 'department', nameVi: 'Ban', nameEn: 'Departments',
    items: [{ code: 'department.manage', vi: 'Tạo, sửa, xóa ban', en: 'Create, edit and delete departments' }]
  },
  {
    key: 'board', nameVi: 'Board', nameEn: 'Boards',
    items: [
      { code: 'board.create', vi: 'Tạo board mới', en: 'Create boards' },
      { code: 'board.update', vi: 'Sửa board và quản lý cột', en: 'Edit boards and manage columns' },
      { code: 'board.delete', vi: 'Lưu trữ board', en: 'Archive boards' }
    ]
  },
  {
    key: 'task', nameVi: 'Task', nameEn: 'Tasks',
    items: [
      { code: 'task.create', vi: 'Tạo task trong board', en: 'Create tasks' },
      { code: 'task.assign', vi: 'Giao hoặc bỏ giao người nhận', en: 'Assign or unassign people' },
      { code: 'task.update_any', vi: 'Sửa và di chuyển mọi task', en: 'Edit and move any task' },
      { code: 'task.update_assigned', vi: 'Sửa và di chuyển task được giao cho mình', en: 'Edit and move tasks assigned to you' },
      { code: 'task.delete', vi: 'Xóa task vào Thùng rác', en: 'Move tasks to Trash' }
    ]
  },
  {
    key: 'comment', nameVi: 'Bình luận', nameEn: 'Comments',
    items: [
      { code: 'comment.create', vi: 'Bình luận ở task xem được', en: 'Comment on visible tasks' },
      { code: 'comment.delete_any', vi: 'Xóa bình luận của người khác', en: "Delete other people's comments" }
    ]
  },
  {
    key: 'system', nameVi: 'Hệ thống', nameEn: 'System',
    items: [
      { code: 'reminder.configure', vi: 'Cấu hình mốc nhắc deadline', en: 'Configure deadline reminders' },
      { code: 'audit.view', vi: 'Xem nhật ký quản trị', en: 'View the audit log' }
    ]
  }
];

export const presets = [
  { key: 'basic', vi: 'Thành viên cơ bản', en: 'Basic member', count: 3, descVi: 'Xem thành viên, sửa task được giao, bình luận.', descEn: 'See members, edit assigned tasks, comment.' },
  { key: 'lead', vi: 'Trưởng ban', en: 'Department lead', count: 9, descVi: 'Cơ bản + quản lý board, task, giao việc, xem MSSV/email.', descEn: 'Basic + boards, tasks, assignment, member detail.' },
  { key: 'people', vi: 'Quản lý nhân sự', en: 'People manager', count: 6, descVi: 'Cơ bản + thêm, sửa, khóa thành viên, xem MSSV/email.', descEn: 'Basic + add, edit and deactivate members, member detail.' }
];

export const defaultPermissions = ['member.view', 'task.update_assigned', 'comment.create'];

export const auditRows = [
  { time: '23/11/2026 · 14:32', actor: 'B', actionVi: 'Cấp quyền', actionEn: 'Granted permission', target: 'Nguyễn Văn A', detailVi: 'task.assign', detailEn: 'task.assign' },
  { time: '23/11/2026 · 11:18', actor: 'B', actionVi: 'Thu hồi quyền', actionEn: 'Revoked permission', target: 'Lê Văn C', detailVi: 'board.create', detailEn: 'board.create' },
  { time: '23/11/2026 · 09:04', actor: 'D', actionVi: 'Khóa tài khoản', actionEn: 'Deactivated account', target: 'Vũ Quốc F', detailVi: 'Thành viên rời CLB', detailEn: 'Member left the club' },
  { time: '22/11/2026 · 16:47', actor: 'B', actionVi: 'Áp mẫu quyền', actionEn: 'Applied preset', target: 'Lê Văn C', detailVi: 'Trưởng ban', detailEn: 'Department lead' },
  { time: '22/11/2026 · 10:15', actor: 'B', actionVi: 'Cập nhật cấu hình', actionEn: 'Updated settings', target: 'Nhắc deadline', detailVi: 'Mốc nhắc: 2 ngày, 1 ngày', detailEn: 'Milestones: 2 days, 1 day' },
  { time: '21/11/2026 · 15:30', actor: 'D', actionVi: 'Sửa thành viên', actionEn: 'Edited member', target: 'Ngô Thị I', detailVi: 'Gán ban Nhân sự', detailEn: 'Assigned to Nhân sự' },
  { time: '21/11/2026 · 09:12', actor: 'B', actionVi: 'Tạo ban', actionEn: 'Created department', target: 'Sáng tạo', detailVi: 'Ban mới', detailEn: 'New department' }
];

export const historyRows = [
  { actor: 'B', time: '23/11/2026 · 14:32', vi: 'đã đổi priority từ Trung bình sang Khẩn', en: 'changed priority from Medium to Urgent', revertible: true },
  { actor: 'A', time: '23/11/2026 · 15:02', vi: 'đã bình luận', en: 'commented', revertible: false },
  { actor: 'C', time: '23/11/2026 · 11:05', vi: 'đã chuyển task từ Cần làm sang Đang làm', en: 'moved the task from To do to In progress', revertible: true },
  { actor: 'C', time: '22/11/2026 · 17:40', vi: 'đã giao task cho Nguyễn Văn A', en: 'assigned the task to Nguyễn Văn A', revertible: true },
  { actor: 'C', time: '22/11/2026 · 17:39', vi: 'đã bật cờ ẩn', en: 'turned on the hidden flag', revertible: true },
  { actor: 'A', time: '21/11/2026 · 16:20', vi: 'đã đổi hạn chót từ 25/11 sang 22/11', en: 'changed the due date from 25 Nov to 22 Nov', revertible: false, reverted: true },
  { actor: 'C', time: '21/11/2026 · 09:14', vi: 'đã tạo task', en: 'created the task', revertible: false }
];
