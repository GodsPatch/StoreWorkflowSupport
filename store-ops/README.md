# Hệ thống đơn hàng trà sữa

Hướng dẫn này gồm đủ các đợt. Hệ thống nhận đơn từ landing page, trang nhập đơn của nhân viên và Google Form dự phòng, lưu vào Google Sheets, đếm suất, tạo QR chuyển khoản, lập danh sách chuẩn bị và giao, rồi gửi email báo đơn, danh sách, báo cáo cuối ngày và cảnh báo cho nhóm.

```
Landing page ────┐
Trang nhập đơn ──┼─► Apps Script ─► Google Sheets
Form dự phòng ───┘        ▲
                          │ lấy đơn, danh sách, báo cáo; gửi xong thì xác nhận
                         n8n ─► Email nhóm
```

Đơn lưu xong trên Google trước khi n8n biết, nên máy chạy n8n tắt thì email đến muộn nhưng đơn không mất. Tab **Danh sách** trên trang nhập đơn lấy thẳng từ Apps Script, nên vẫn dùng được khi n8n tắt.

**Từ ngữ:** giao diện và email dùng từ chung cho mọi mặt hàng: **người chuẩn bị**, **danh sách chuẩn bị**, và đơn vị đếm lấy từ ô `unit_label` trong `Cấu hình`, mặc định **phần**. Tên khoá nội bộ như `max_cups`, `cups` giữ nguyên để không phải đổi Sheet và n8n.

```
store-ops/
├── apps-script/             # dán vào Google Apps Script
│   ├── Code.gs
│   ├── Logic.gs
│   ├── Staff.html           # trang nhập đơn, giao diện Trân châu nắng
│   └── appsscript.json
├── n8n/                     # 3 workflow, import riêng từng cái
│   ├── order-notify.json    # báo đơn mới, cảnh báo, đơn dự phòng lỗi, mỗi phút
│   ├── ops-lists.json       # danh sách chuẩn bị và giao, mỗi 30 phút từ 8h đến 21h
│   └── daily-report.json    # báo cáo, 22h mỗi ngày
├── landing-example.html     # form mẫu cho người làm trang
└── tests/                   # chạy ngoài Google
```

## 1. Tạo Sheet và dán script

1. Dùng tài khoản Google chung của nhóm, tạo một Google Sheet mới.
2. Trong Sheet, mở **Tiện ích mở rộng → Apps Script**. Script phải được mở từ đây để gắn với đúng Sheet.
3. Trong **Cài đặt dự án** (biểu tượng bánh răng), bật **Hiển thị tệp kê khai "appsscript.json"**.
4. Về **Trình chỉnh sửa**, tạo các tệp và dán nội dung tương ứng:

   | Tệp trong Apps Script | Dán từ |
   |---|---|
   | `Code.gs` | `apps-script/Code.gs` |
   | `Logic.gs` | `apps-script/Logic.gs` |
   | `Staff.html` (chọn loại HTML, đặt tên `Staff`) | `apps-script/Staff.html` |
   | `appsscript.json` | `apps-script/appsscript.json` |

5. Chọn hàm `setup` trên thanh công cụ, bấm **Chạy**, rồi cấp quyền khi Google hỏi.

Sau bước này Sheet có các tab `Đơn hàng`, `Cấu hình`, `Món`, `Topping`, `Đơn lỗi`. Chạy lại `setup` nhiều lần không mất dữ liệu.

### Nâng cấp Sheet đã chạy đợt 1

Làm đúng thứ tự, đơn đang có được giữ nguyên:

1. Dán đè cả 4 tệp ở trên, gồm cả `appsscript.json`.
2. Chọn hàm `doGet`, bấm **Chạy** và cấp quyền mới (Google Form, trigger). Bước này chỉ để cấp quyền, không đổi dữ liệu.
3. Tạo phiên bản mới của web app như cuối mục 3. Bản mới đọc được cả tiêu đề tiếng Anh cũ và tiếng Việt.
4. Chạy `setup`. Bước này đổi tên tab và tiêu đề sang tiếng Việt ngay tại chỗ, thêm cột `QR`, `Lý do gọi`, tab `Đơn lỗi`, các dòng cấu hình mới và kiểu cho các tab; chuyển cột của tab `Cấu hình` thành `Ý nghĩa`, `Giá trị`, `Khoá`. Dữ liệu và giá trị đã sửa được giữ nguyên. Nếu Sheet đã có sẵn một tab trùng tên mới, hệ thống dùng tab đó và không xoá tab tên cũ, nên hãy kiểm tra trước.
5. Điền các dòng cấu hình mới ở mục 7.
6. Làm tiếp mục 4b, rồi import 2 workflow mới và cập nhật `order-notify` ở mục 5.

### Nâng cấp lên giao diện Trân châu nắng

Dành cho Sheet đã chạy đợt 2. Đơn và giá trị đã sửa được giữ nguyên.

1. Dán đè `Code.gs`, `Logic.gs`, `Staff.html`.
2. Tạo **Phiên bản mới** của web app như cuối mục 3.
3. Chạy `setup`. Bước này:
   - đổi ô `orders_open` từ `TRUE`/`FALSE` sang **Mở cửa**/**Đóng cửa** và đặt ô chọn có màu xanh/đỏ nhạt; giá trị lạ, vốn đã được tính là đóng, thành **Đóng cửa**;
   - thêm dòng `unit_label` với giá trị **phần**;
   - đặt kiểm tra số cho các ô số trong `Cấu hình`;
   - đổi tiêu đề cột `Cốc` thành `Số lượng` và thêm cột `Lý do gọi`, `Lý do huỷ` ở cuối tab `Đơn hàng`;
   - thay câu `Ý nghĩa` còn đúng nguyên văn câu mặc định cũ bằng câu mới; câu nhóm đã tự sửa được giữ.
4. Mở tab `Cấu hình`, kiểm tra ô Nhận đơn đúng như mong muốn.
5. Chạy `setupBackupForm` để đổi câu hỏi số lượng trong Form dự phòng sang chữ mới. Link Form không đổi.
6. Import lại `n8n/order-notify.json` theo mục 5, sửa node **Cấu hình** và credential, rồi xoá hoặc tắt bản cũ. Không cần import lại `ops-lists.json` và `daily-report.json`; bản mới của `ops-lists.json` chỉ khác tên workflow.
7. Đặt thuộc tính `MANAGER_PASSWORD` theo mục 2 để dùng mục **Cài đặt** ⚙ trên trang nhập đơn.
8. Từ bản này, Giao chỉ gồm đơn đã làm xong (`dang_giao`), còn `dang_lam` nghĩa là đang chuẩn bị. Nếu nhóm từng dùng `dang_lam` cho đơn đã làm xong chờ giao, đổi các đơn đó sang `dang_giao` trong Sheet, hoặc bấm **Làm xong** trên trang, để chúng hiện ở Giao.

Đơn tạo trước khi chạy `setup` không có lý do cần gọi; email và mục đang chờ vẫn báo các đơn đó cần gọi, chỉ không ghi lý do.

## 2. Đặt secret

Trong **Cài đặt dự án → Thuộc tính tập lệnh**, thêm hai thuộc tính. Mỗi giá trị là một chuỗi ngẫu nhiên dài, tạo bằng `openssl rand -hex 24`.

| Thuộc tính | Dùng cho |
|---|---|
| `N8N_KEY` | n8n lấy đơn, danh sách, báo cáo và xác nhận đã gửi |
| `STAFF_KEY` | link trang nhập đơn, gồm cả tab Danh sách |
| `MANAGER_PASSWORD` | mật khẩu quản lý để mở mục **Cài đặt** ⚙ trên trang nhập đơn. Chọn mật khẩu dài, dễ gõ trên điện thoại, chỉ báo cho người quản lý |

Chưa đặt khoá thì các endpoint này luôn từ chối; chưa đặt `MANAGER_PASSWORD` thì mục Cài đặt luôn từ chối. Không ghi khoá hay mật khẩu vào repo. Đổi `MANAGER_PASSWORD` là người đang mở Cài đặt bị đẩy ra ở lần lưu kế tiếp.

Script tự thêm các thuộc tính `LAST_ORDER_NUMBER`, `LOW_STOCK_ALERTED_AT`, `OPS_LISTS_SIGNATURE`, `BACKUP_FORM_ID`, `CONFIG_LAST_GOOD`, `CONFIG_ALERTED`, `MANAGER_FAILS`, `MANAGER_LOCKED_UNTIL`. Không cần đặt tay.

## 3. Deploy web app

1. Bấm **Triển khai → Triển khai mới**, loại **Ứng dụng web**.
2. **Thực thi với tư cách:** Tôi. **Người có quyền truy cập:** Bất kỳ ai.
3. Bấm **Triển khai** và sao chép URL kết thúc bằng `/exec`.

Từ giờ các link là:

| Dùng cho | Link |
|---|---|
| Người làm trang, lấy menu và gửi đơn | `<URL>` |
| Nhân viên nhập đơn Messenger và xem danh sách | `<URL>?page=staff&key=<STAFF_KEY>` |

Link trang nhập đơn chứa khoá và mở được SĐT, địa chỉ khách, số phần còn lại và số đơn đang chờ, chỉ gửi trong nhóm. Nếu link bị lộ, đổi `STAFF_KEY` là link cũ hết tác dụng ngay; người mở link cũ thấy "Link này không còn dùng được. Hỏi quản lý link mới."

**Sau khi đã đổi tên tab và tiêu đề sang tiếng Việt, không quay lại phiên bản cũ hơn.** Bản cũ chỉ đọc được tên tiếng Anh, nên sẽ báo `SERVER_ERROR` và n8n đỏ. Bản trước giao diện Trân châu nắng cũng không đọc được **Mở cửa** và sẽ coi là đóng cửa.

**Mỗi lần sửa code:** vào **Triển khai → Quản lý triển khai → biểu tượng bút chì → Phiên bản mới**, rồi **Triển khai**. Cách này giữ nguyên URL. Không tạo triển khai mới, vì URL sẽ đổi.

## 4. Tạo mật khẩu ứng dụng Gmail

1. Tài khoản Gmail dùng để gửi phải bật xác minh 2 bước.
2. Mở https://myaccount.google.com/apppasswords, tạo một mật khẩu tên `n8n store ops`.
3. Sao chép chuỗi 16 ký tự. Google chỉ hiện một lần.

## 4b. Tạo Form dự phòng

Làm trước ngày bán, sau khi đã thay menu thật trong `Món` và `Topping`.

1. Trong Apps Script, chọn hàm `setupBackupForm`, bấm **Chạy**, cấp quyền nếu Google hỏi.
2. Mở **Nhật ký thực thi**, sao chép dòng `Link Form dự phòng: ...`. Lưu link này cùng chỗ với các link vận hành.
3. Mở link trong tab ẩn danh để chắc khách không phải đăng nhập. Nếu Form đòi đăng nhập, mở Form trong Google Drive, vào **Cài đặt → Phản hồi** và tắt yêu cầu đăng nhập.

**Sau khi đổi menu, giá, phí ship hoặc đơn vị, chạy lại `setupBackupForm`.** Hàm dùng lại Form và link cũ, cập nhật lựa chọn và bảng giá, không tạo trigger trùng. Tiền luôn do server tính theo giá hiện tại; món đã đổi tên mà chưa chạy lại thì đơn vào `Đơn lỗi`.

**Nếu `setupBackupForm` báo không mở được Form:** hàm dừng lại và giữ nguyên link cũ cùng trigger, vì lỗi có thể chỉ là tạm thời. Chạy lại sau ít phút và kiểm tra Form còn trong Google Drive của tài khoản chung, kể cả thùng rác. Chỉ xoá thuộc tính `BACKUP_FORM_ID` khi thật sự muốn tạo Form mới. Khi đó link mới thay link cũ, nên phải gỡ link cũ ở mọi nơi đã đăng, vì đơn gửi vào link cũ sẽ không còn thành đơn.

**Khi landing lỗi:** gửi link Form lên page và trang. Khách gửi Form thì đơn vào `Đơn hàng` với `Kênh` là `backup`, cùng kiểm tra, đếm suất và giới hạn SĐT như landing, và có trong danh sách và email như đơn khác.

**Khi landing chạy lại:** gỡ link Form ở mọi nơi đã đăng, rồi mở Form, vào tab **Câu trả lời** và tắt **Chấp nhận câu trả lời**, để khách giữ link cũ không đặt thêm qua kênh này. Lần sau cần dùng thì bật lại; link không đổi. Đơn đã gửi trước đó vẫn được giữ.

**Giới hạn của Form:** mỗi lần gửi một món, chỉ COD, và khách không thấy mã đơn hay tổng tiền. Form không từ chối được khách, nên đơn sai dữ liệu hoặc hết suất được ghi vào `Đơn lỗi` và email cho nhóm với tiêu đề `⚠️ 1 đơn từ form dự phòng chưa nhận được` trong lần báo tiếp theo. Nhóm gọi lại khách theo nội dung trong cột `Nội dung`, nhập tay ở trang nhập đơn nếu còn nhận được. Mọi phản hồi cũng nằm trong tab **Câu trả lời** của Form.

## 5. Import workflow vào n8n

> **Không chạy `n8n-mvp/scripts/import-workflows.sh`**, vì lệnh đó ghi đè workflow Messenger đang có token dán tay. Không chép các file này vào `n8n-mvp/workflows/`.

1. Mở n8n tại http://localhost:5679. Vào **Credentials → Create**, tạo hai credential:

   | Loại | Tên | Giá trị |
   |---|---|---|
   | **SMTP** | `Store Ops - Gmail SMTP` | User: Gmail gửi. Password: mật khẩu ứng dụng. Host: `smtp.gmail.com`. Port: `465`. SSL/TLS: bật |
   | **Query Auth** | `Store Ops - khoa Apps Script` | Name: `key`. Value: giá trị `N8N_KEY` |

2. Với **từng file** dưới đây, tạo workflow mới, bấm **⋯ → Import from File**, rồi chọn đúng credential cho các node trong bảng:

   | File | Chạy khi nào | Node cần chọn credential |
   |---|---|---|
   | `n8n/order-notify.json` | Mỗi phút | **Lấy đơn chờ báo**, **Đánh dấu đã báo**, **Gửi email** |
   | `n8n/ops-lists.json` | Mỗi 30 phút từ 8h00 đến 21h00, giờ Việt Nam | **Lấy danh sách**, **Xác nhận đã gửi**, **Gửi email** |
   | `n8n/daily-report.json` | 22h00 mỗi ngày, giờ Việt Nam | **Lấy báo cáo**, **Gửi email** |

3. Trong mỗi workflow, mở node **Cấu hình**, sửa ba giá trị:
   - `web_app_url`: URL `/exec` ở bước 3
   - `notify_to`: email nhận thông báo, nhiều người thì cách nhau bằng dấu phẩy
   - `from_email`: Gmail gửi, trùng với User của credential SMTP
4. Cả ba workflow đang tắt. Thử theo mục 6 bằng **Execute workflow**, rồi bấm **Publish** để chạy theo lịch.

**Đã có `order-notify` từ đợt trước:** import lại file để có câu chữ email mới và email cảnh báo Cấu hình, sửa lại node **Cấu hình** và credential, rồi xoá hoặc tắt bản cũ. Không để hai bản cùng chạy, vì đơn có thể bị báo hai lần.

Máy chạy n8n tắt lúc 22h thì báo cáo hôm đó không tự gửi bù. Bật lại rồi bấm **Execute workflow** trong `daily-report` là có báo cáo mới nhất.

## 6. Thử nguyên luồng

Làm theo thứ tự, tối 4/11/2026 là hạn chót.

| # | Việc làm | Kết quả đúng |
|---|---|---|
| 1 | Mở `<URL>` trong trình duyệt | JSON có menu, giá, phí ship, `orders_open: true`, `transfer_enabled: false` |
| 2 | Mở `<URL>?page=staff&key=sai` | Trang báo "Link này không còn dùng được. Hỏi quản lý link mới.", không có dữ liệu |
| 3 | Mở `<URL>?action=pending&key=sai`, rồi đổi `pending` thành `ops_lists` và `report` | Cả ba đều `UNAUTHORIZED`, không có đơn |
| 4 | Sửa ba giá trị trong `landing-example.html` (xem mục 8), mở bằng điện thoại hoặc trình duyệt, đặt 2 phần đến 10km với SĐT thật | Xem trước và mã đơn đều báo 108.000đ. Một dòng mới trong `Đơn hàng`. Chưa có lựa chọn chuyển khoản |
| 5 | Tải lại trang, đặt thêm một đơn | Mã đơn tăng dần, mỗi đơn một dòng |
| 6 | Đặt đơn với tên `=1+1` | Ô tên hiện đúng `=1+1`, không tính ra 2 |
| 7 | Mở link trang nhập đơn trên điện thoại | Nền kem, dải vàng đầu trang ghi **Đang mở cửa · Còn … phần · … đơn đang chờ**, hai tab **Nhập đơn** và **Danh sách**, thanh đáy có Tổng và **Lưu đơn**. Bật chế độ tối của máy: trang vẫn sáng như cũ |
| 8 | Ở trang nhập đơn, bấm `+` lên 2 phần, chạm chip topping, **Giao tận nơi**, **Đến 10km** | Thanh đáy hiện **108.000đ** và "2 phần · ship 10.000đ" ngay khi đổi |
| 9 | Bấm **Lưu đơn** khi chưa nhập tên | Ô tên viền đỏ, câu lỗi dưới ô, trang cuộn tới ô đó |
| 10 | Nhập đơn chuyển khoản có link Facebook | Dòng mới có `Kênh` = `messenger`, `Thanh toán` = `cho_chuyen_khoan`. Màn hình đã lưu có mã đơn lớn, cờ **Chờ chuyển khoản** và báo chưa có tài khoản nhận tiền |
| 11 | Bấm **Execute workflow** trong `order-notify` | Nhận một email tiêu đề `🔔 … đơn mới · … phần` liệt kê các đơn trên. Cột ẩn `Đã báo` có giờ |
| 12 | Bấm **Execute workflow** lần nữa | Không có email mới |
| 13 | Đặt đơn COD 5 phần rồi chạy workflow | Email có dòng đầu "Có … đơn mới, 1 đơn cần gọi trước khi làm." và dòng của đơn ghi `CẦN GỌI: đơn lớn, trả tiền mặt`. Cột `Lý do gọi` có cùng lý do |
| 14 | Trong tab `Cấu hình`, đặt `low_stock_alert_cups` thấp hơn tổng phần hiện có, rồi chạy workflow hai lần | Lần đầu có email `⚠️ Còn … phần cuối`, lần sau không có. Dải trạng thái hiện số phần còn lại chữ đậm |
| 15 | Đặt `max_cups` bằng tổng phần hiện có, rồi đặt thêm một đơn ở trang nhập đơn | Báo "Hết suất. Còn 0 phần trong đợt này." ngay trên thanh đáy, không có dòng mới |
| 16 | Đổi một đơn sang `huy` trong cột `Trạng thái`, rồi đặt đơn nhỏ hơn số phần đó | Đặt được, suất đã được trả lại |
| 17 | Đổi ô Nhận đơn thành **Đóng cửa**, thử đặt đơn, rồi bấm **Làm mới** ở trang nhập đơn | Landing báo tạm đóng. Trang nhập đơn hiện huy hiệu đỏ **Đang đóng cửa**, nút **Lưu đơn** bị khoá và ghi "Đang đóng cửa, chưa nhận đơn." Đổi lại **Mở cửa** |
| 18 | Trong tab `Cấu hình`, thử gõ chữ vào ô `max_cups` | Google từ chối ngay |
| 19 | Xoá trống ô `shipping_fee_den_10km`, đặt một đơn đến 10km, rồi chạy `order-notify` hai lần | Đơn vẫn nhận với phí ship cũ. Lần đầu có email `⚠️ Tab Cấu hình đang có ô sai` nêu tên ô và giá trị cũ, lần sau không có. Điền lại 10000 |
| 20 | Đặt `unit_label` = `hộp`, bấm **Làm mới** ở trang nhập đơn và chạy `ops-lists` | Trang, danh sách và email ghi "hộp". Đổi lại `phần` |
| 21 | Sửa giá trong `Món`, đặt đơn mới | Tổng tiền theo giá mới |
| 22 | Bấm **Publish**. Tắt n8n (`docker compose stop n8n` trong `n8n-mvp/`; workflow Messenger cũng dừng trong lúc này), đặt một đơn, rồi bật lại (`docker compose start n8n`) | Trong vòng 2 phút có email báo đơn đó, đúng một lần |
| 23 | Điền `bank_code`, `bank_account`, `bank_account_name`. Tải lại landing, đặt đơn chuyển khoản | Có lựa chọn chuyển khoản. Trang hiện QR, link mở ảnh, ngân hàng, số tài khoản, tên tài khoản, số tiền, nội dung là mã đơn |
| 24 | Quét QR bằng app ngân hàng của nhóm, **không bấm chuyển nếu không cần** | App hiện đúng tài khoản, tên, số tiền, nội dung |
| 25 | Nhập đơn chuyển khoản ở trang nhập đơn | Màn hình đã lưu có QR, ngân hàng, số tài khoản, số tiền, nội dung và link ảnh để gửi cho khách |
| 26 | Trên điện thoại, mở tab **Danh sách → Chuẩn bị** | Đơn chuyển khoản chưa nhận tiền và đơn cần gọi chưa gọi không có ở đây, mà nằm ở **Đang chờ** kèm SĐT, số tiền và lý do. Món cùng topping gom một thẻ, số phần lớn bên trái cộng đúng, ghi chú hiện kèm mã đơn |
| 27 | Bấm "… đơn đang chờ" trên dải vàng | Mở tab **Danh sách → Đang chờ** |
| 28 | Đánh dấu `da_nhan` cho đơn chuyển khoản, tích `Đã gọi` cho đơn cần gọi, bấm **Làm mới** | Hai đơn đó hiện ở **Chuẩn bị**, giờ cập nhật đổi |
| 29 | Điền `shop_address`. Bấm **Làm xong** cho nhiều đơn giao hơn `maps_max_stops` (chỉ đơn đã làm xong mới vào Giao) có địa chỉ chứa `/` và `&`, rồi mở **Giao** | Gom theo khu vực, có nhiều nút **Mở bản đồ**. Mở từng link trên điện thoại: đủ điểm, đúng địa chỉ. Tiền thu của COD bằng tổng tiền, của `da_nhan` bằng 0, cuối nhóm có **Tổng thu nhóm này**. Đơn tự lấy đã làm xong nằm riêng |
| 30 | Bấm **Execute workflow** trong `ops-lists` | Nhận email `📋 Cần chuẩn bị … phần · giao … điểm`, mở thẳng vào mục CHUẨN BỊ, là văn bản thuần, link bản đồ bấm được |
| 31 | Bấm **Execute workflow** lần nữa | Không có email mới |
| 32 | Bấm **Đang làm** trên một đơn ở **Chuẩn bị**, rồi chạy `ops-lists` | Đơn vẫn ở Chuẩn bị với nhãn **Đang làm**; có email mới ghi "đang làm" cạnh mã đơn |
| 33 | Đổi một đơn sang `bom`, đặt đơn COD 1 phần cùng SĐT, rồi chạy `order-notify` | Email ghi `CẦN GỌI: SĐT từng bom TS-…` với mã đơn bom trước đó. Trang của khách không báo gì khác |
| 34 | Làm mục 4b, mở link Form trong tab ẩn danh, gửi đơn đúng | Một dòng `Kênh` = `backup`, có email báo, có trong danh sách chuẩn bị |
| 35 | Gửi Form với SĐT `123` | Không có đơn mới. Một dòng trong `Đơn lỗi` đủ câu trả lời. Lần chạy `order-notify` sau có email `⚠️ 1 đơn từ form dự phòng chưa nhận được` nói rõ đơn của ai và vì sao, lần sau nữa không có |
| 36 | Đặt `max_cups` bằng tổng phần hiện có rồi gửi Form đúng | Như dòng trên, lý do là hết suất |
| 37 | Bấm **Execute workflow** trong `daily-report` và đối chiếu với `Đơn hàng` | Tiêu đề `📊 Hôm nay: … phần · …đ`. Số phần, đơn theo trạng thái, tỷ lệ bom, phần còn lại, doanh thu khớp |
| 38 | Bấm **Publish** cả ba workflow. Tắt n8n, mở trang nhập đơn, bấm **Làm mới** ở tab Danh sách | Vẫn xem được |
| 39 | Chưa đặt `MANAGER_PASSWORD`, bấm ⚙ và nhập bất kỳ | Báo cần đặt mật khẩu trong Apps Script |
| 40 | Đặt `MANAGER_PASSWORD`, bấm ⚙, nhập sai một lần rồi nhập đúng | Lần sai báo "Mật khẩu chưa đúng.", lần đúng hiện Cài đặt với giá trị đang có trong Sheet |
| 41 | Trong Cài đặt, chạm **Đóng cửa** | Hiện "Đã lưu", dải đổi sang **Đang đóng cửa**, ô Nhận đơn trong `Cấu hình` là **Đóng cửa**, landing báo tạm đóng. Chạm **Mở cửa** để mở lại |
| 42 | Nhập `0` vào giới hạn tổng số phần, bấm **Lưu** | Báo dưới ô, `max_cups` trong Sheet không đổi |
| 43 | Tắt một món | Tab `Món` ghi `inactive`, landing tải lại không còn món đó. Bật lại |
| 44 | Bấm **Khoá**, rồi tải lại trang và bấm ⚙ | Phải nhập lại mật khẩu |
| 45 | Nhập sai mật khẩu 5 lần, rồi nhập đúng | Báo "Nhập sai quá nhiều lần, thử lại sau 10 phút." Sau 10 phút mở được |
| 46 | Đặt đơn COD 5 phần, mở **Danh sách → Đang chờ**, bấm **Đã gọi** | Thẻ có đủ tên, giờ, SĐT bấm gọi, món, địa chỉ, tổng, lý do. Sau khi bấm, đơn sang **Chuẩn bị**, cột `Đã gọi` được tích |
| 47 | Ở **Chuẩn bị**, bấm **Đang làm**, rồi **Làm xong** | Đơn có nhãn Đang làm, rồi rời Chuẩn bị và hiện ở **Giao**; `Trạng thái` thành `dang_giao` |
| 48 | Ở **Giao**, bấm **Đã giao** | `Trạng thái` thành `xong`, đơn rời danh sách |
| 49 | Bấm **Bom** trên một đơn đang giao, rồi **Thôi**; bấm lại và **Xác nhận bom** | Lần đầu không ghi gì; lần sau `Trạng thái` thành `bom` |
| 50 | Nhập một đơn, ở màn hình đã lưu bấm **Huỷ đơn này**, chọn **Nhập nhầm**, xác nhận | `Trạng thái` thành `huy`, `Lý do huỷ` là Nhập nhầm, dòng vẫn còn. Chạy `order-notify`: không có email cho đơn đó |
| 51 | Hai điện thoại cùng mở Danh sách, cả hai bấm **Đang làm** trên cùng đơn | Chỉ máy bấm trước được ghi; máy sau thấy "Đơn TS-… đã đổi trạng thái, danh sách đã được làm mới." |
| 52 | Bấm mã đơn bất kỳ trong Danh sách | Mở chi tiết đơn với trạng thái và nút hợp lệ; **Đóng** về đúng mục |
| 53 | Mở Cài đặt, xem ô **Hôm nay**, rồi chạy `daily-report` | Số phần, tiền, đơn theo trạng thái khớp với báo cáo |

Thử xong, đưa `Cấu hình` về số thật, xoá các dòng thử trong `Đơn hàng` và `Đơn lỗi`, và xoá thuộc tính `LOW_STOCK_ALERTED_AT`, `OPS_LISTS_SIGNATURE`, `CONFIG_ALERTED` nếu có. Mã đơn tiếp tục tăng, không quay lại từ đầu. Muốn đếm lại từ `TS-0001`, xoá thêm thuộc tính `LAST_ORDER_NUMBER`.

Nếu Google báo lỗi đăng nhập khi lưu đơn hoặc xem danh sách ở trang nhập đơn, thường do trình duyệt đang đăng nhập nhiều tài khoản Google. Mở link trong tab ẩn danh.

## 7. Vận hành hằng ngày

**Trang nhập đơn:** dải vàng đầu trang luôn cho biết đang mở hay đóng cửa, còn bao nhiêu phần và bao nhiêu đơn đang chờ; số liệu cập nhật khi mở trang, khi bấm **Làm mới** và sau mỗi lần lưu đơn. Tab **Nhập đơn** dùng để nhập đơn đã chốt trên Messenger, tổng tiền luôn hiện ở thanh đáy. Tab **Danh sách** có ba mục **Chuẩn bị**, **Giao**, **Đang chờ**. Chuyển tab không mất dữ liệu đang nhập, và máy nhớ tab dùng lần cuối. Mất mạng khi lưu thì dữ liệu được giữ; bấm **Lưu đơn** lần nữa không tạo đơn trùng. Trang luôn dùng giao diện sáng, kể cả khi điện thoại bật chế độ tối. Không sửa được món, số lượng, tiền hay địa chỉ trên trang; sửa trong tab `Đơn hàng`. Trạng thái đơn thì đổi ngay trên trang, xem mục **Đổi trạng thái trên trang** dưới đây.

**Đổi trạng thái trên trang:** trong tab **Danh sách**, mỗi đơn có nút phù hợp với mục đang xem. Nút ghi thẳng vào đúng cột của tab `Đơn hàng`, nên suất, danh sách, email và báo cáo khớp ngay. Sau mỗi lần bấm, danh sách và dải trạng thái tự làm mới.

| Mục | Nút | Ghi vào Sheet |
|---|---|---|
| Đang chờ | **Đã gọi** | Tích `Đã gọi`; đơn sang Chuẩn bị nếu không còn chờ gì |
| Đang chờ | **Đã nhận tiền** | `Thanh toán` = `da_nhan`. Cần bấm xác nhận lần hai; xem app ngân hàng trước |
| Chuẩn bị | **Đang làm** | `moi` → `dang_lam`; đơn vẫn ở Chuẩn bị với nhãn Đang làm |
| Chuẩn bị | **Làm xong** | → `dang_giao`; đơn sang Giao, hoặc sang Tự lấy với nhãn Chờ khách lấy |
| Giao, Tự lấy | **Đã giao** / **Đã trao** | `dang_giao` → `xong`; đơn rời danh sách |
| Giao, Tự lấy | **Bom** | → `bom`; suất vẫn tính. Cần bấm xác nhận lần hai |
| Mọi mục | **Huỷ** | → `huy`, ghi `Lý do huỷ`; suất được trả lại. Cần bấm xác nhận lần hai và chọn lý do |

- Bấm mã đơn (chữ gạch chân) ở bất kỳ mục nào để mở **chi tiết đơn**: đủ thông tin khách, món, tiền, trạng thái hiện tại và mọi nút hợp lệ cho đơn đó. Bấm **Đóng** (hoặc phím Esc) để về đúng mục đang xem.
- **Huỷ** thay cho xoá: không xoá dòng trong Sheet, để giữ mã đơn, chống trùng, đếm suất và lịch sử. Chọn lý do Khách huỷ, Nhập nhầm, Hết hàng, hoặc Khác kèm một dòng ngắn. Màn hình đã lưu có nút **Huỷ đơn này** cho đơn vừa nhập nhầm. Đơn đã `xong` hoặc `bom` không huỷ được trên trang; cần thì sửa tay trong Sheet.
- Email đơn mới bỏ qua đơn đang ở `huy` lúc n8n lấy danh sách chờ báo. Đơn huỷ sau khi n8n đã lấy danh sách (thường chỉ vài giây trước khi gửi) vẫn có thể có trong email đó. Đơn huỷ rồi được mở lại (đổi về `moi`) vẫn được báo. Email danh sách luôn bỏ đơn huỷ.
- Hai người cùng bấm trên một đơn thì chỉ lần bấm đầu được ghi. Người sau thấy "Đơn TS-… đã đổi trạng thái, danh sách đã được làm mới." và danh sách tự làm mới.
- Không sửa được món, số lượng, tiền hay địa chỉ trên trang, và trang không có nút hoàn tác. Huỷ đã có bước xác nhận và lý do; các lần bấm nhầm khác (Đang làm, Làm xong, Đã giao, Bom, Đã gọi, Đã nhận tiền) thì sửa lại trong Sheet, ở cột `Trạng thái`, `Thanh toán` hoặc `Đã gọi`. Huỷ nhầm thì đổi `Trạng thái` về `moi` trong Sheet.

**Mục Cài đặt (dành cho quản lý):** bấm ⚙ cạnh hai tab, nhập mật khẩu quản lý (`MANAGER_PASSWORD`), bấm **Mở cài đặt**. Ở đây đổi được mà không cần mở Sheet:

| Mục | Cách lưu | Ghi vào |
|---|---|---|
| Nhận đơn: **Mở cửa** / **Đóng cửa** | Lưu ngay khi chạm, dải trạng thái đổi theo | `orders_open` trong `Cấu hình` |
| Giới hạn tổng số phần, ngưỡng báo sắp hết suất, số phần tối đa mỗi SĐT, ngưỡng đơn lớn cần gọi | Sửa ô rồi bấm **Lưu** cạnh ô | `max_cups`, `low_stock_alert_cups`, `max_cups_per_phone_public`, `call_threshold_cups` |
| Ba phí ship | Như trên | `shipping_fee_tu_lay`, `shipping_fee_trong_2km`, `shipping_fee_den_10km` |
| Bật tắt từng món | Lưu ngay khi gạt công tắc; món tắt biến khỏi trang bán hàng và trang nhập đơn. Form dự phòng vẫn hiện món đó cho đến khi chạy lại `setupBackupForm`; đơn gửi qua Form với món đã tắt sẽ vào `Đơn lỗi` | Cột `Trạng thái` (`active`/`inactive`) trong tab `Món` |

- Lưu xong hiện "Đã lưu" ngắn. Sau khi bật tắt món hoặc đổi phí ship, nếu đang dùng form dự phòng thì chạy lại `setupBackupForm`. Số sai (chữ, số lẻ, số âm, giới hạn phần hoặc ngưỡng cần gọi bằng 0, phí từ 1 đến 999đ) thì không ghi và báo ngay dưới ô.
- Giá, món mới, topping, tài khoản ngân hàng, địa chỉ quán và đơn vị vẫn sửa trong Sheet.
- Ô **Hôm nay** ở đầu mục Cài đặt cho biết số phần đã bán, tiền đã thu, số đơn theo trạng thái, tỷ lệ bom và số phần còn lại, tính cùng cách với báo cáo 22h. Bấm **Làm mới** để lấy số mới; ô chỉ hiện sau khi nhập mật khẩu.
- Bấm **Khoá** khi dùng xong. Mật khẩu chỉ nằm trong trang đang mở, không lưu trên máy; đóng hay tải lại trang là phải nhập lại.
- Nhập sai 5 lần liên tiếp thì mục Cài đặt bị khoá 10 phút cho mọi người, kể cả khi nhập đúng. Chờ hết 10 phút; không cần làm gì trong Sheet.
- Server kiểm tra mật khẩu ở mọi lần mở và lưu, nên người chỉ có link trang nhập đơn không đổi được cài đặt.

**Làm gọn tab `Đơn hàng`:** chạy `setup` sẽ ẩn cột hệ thống, cảnh báo khi sửa cột không nên sửa, tô màu đơn và bật bộ lọc. Màu xám là `huy`, đỏ nhạt là `bom`, cam là cần gọi chưa gọi, vàng là chờ chuyển khoản. Bấm mũi tên ở vị trí cột để xem cột ẩn; chạy lại `setup` sẽ ẩn lại. Nếu tab đã có luật tô màu riêng, `setup` giữ nguyên và không thêm màu này.

**Tab `Đơn hàng`:** nhân viên đổi cột `Trạng thái` và `Thanh toán` bằng ô chọn, tích `Đã gọi` sau khi gọi. Có thể thêm cột riêng ở bên phải, nhưng đừng đặt tên trùng tiêu đề có sẵn. Không sửa tên các cột có sẵn và không sửa `Số lượng`, `Tổng`, `Chi tiết`, `Đã báo`, `Mã gửi`, `QR`.

Mỗi tiêu đề có thể có ghi chú giải thích, rê chuột hoặc chạm vào ô để xem.

| Cột | Nghĩa |
|---|---|
| `Mã`, `Giờ đặt` | Mã đơn và thời điểm đặt |
| `Trạng thái` | Đơn đang ở bước nào, xem bảng dưới |
| `Thanh toán` | `cod`, `cho_chuyen_khoan` hoặc `da_nhan` |
| `Cần gọi`, `Đã gọi` | Đơn cần gọi trước khi làm, và đã gọi xong chưa |
| `Lý do gọi` | Vì sao cần gọi: "đơn lớn, trả tiền mặt", "SĐT từng bom TS-…" hoặc "nhân viên đánh dấu". Hệ thống tự ghi |
| `Lý do huỷ` | Lý do chọn khi huỷ trên trang nhập đơn: Khách huỷ, Nhập nhầm, Hết hàng hoặc "Khác: …". Hệ thống tự ghi. Sheet mới có cột này ngay sau `Ghi chú`; Sheet cũ được `setup` thêm vào cuối tab |
| `Tên`, `SĐT`, `Liên hệ`, `Địa chỉ` | Thông tin khách |
| `Món`, `Số lượng`, `Ghi chú` | Khách đặt gì, tổng số phần của đơn |
| `Nhận`, `Khu vực` | `giao` hoặc `tu_lay`, và khu vực giao |
| `Trả bằng` | `cod` hoặc `chuyen_khoan` |
| `Ship`, `Tổng` | Do hệ thống tính |
| `Kênh` | `landing`, `messenger` hoặc `backup` |
| `Đã báo`, `Mã gửi`, `Chi tiết`, `QR` | Cột ẩn của hệ thống |

Giá trị trong ô chọn vẫn là `moi`, `huy`, `da_nhan` như cũ.

| `Trạng thái` | Nghĩa | Có tính vào suất |
|---|---|---|
| `moi`, `dang_lam`, `dang_giao`, `xong` | Luồng bình thường | Có |
| `huy` | Huỷ, trả lại suất | Không |
| `bom` | Khách bom hàng, đã làm | Có |

**Khi nào đơn vào danh sách:**

| Danh sách | Điều kiện |
|---|---|
| Chuẩn bị | `Trạng thái` là `moi` hoặc `dang_lam` (hiện nhãn Đang làm); đơn chuyển khoản phải `da_nhan`; đơn `Cần gọi` phải tích `Đã gọi` |
| Giao | `Nhận` là `giao` và `Trạng thái` là `dang_giao` (đã làm xong); cùng điều kiện tiền và gọi như trên |
| Tự lấy | `Nhận` là `tu_lay` và `Trạng thái` là `dang_giao` (đã làm xong, chờ khách đến) |

Chuẩn bị xong mới giao: một đơn không bao giờ nằm cùng lúc ở Chuẩn bị và Giao. Đơn `moi`, `dang_lam` ở Chuẩn bị; bấm **Làm xong** (hoặc đổi sang `dang_giao` trong Sheet) thì đơn sang Giao hoặc Tự lấy. Email danh sách và các con số đếm theo cùng quy tắc. Nếu danh sách ghi `XEM TAY`, cột ẩn `Chi tiết` của đơn đó đã bị sửa hỏng; đọc món ở cột `Món`. Ghi chú của khách hiện kèm mã đơn trong danh sách chuẩn bị. Đơn nhiều món có ghi chú ở mọi dòng của đơn đó.

**Mục đang chờ:** đơn chưa kết thúc mà `chờ chuyển khoản` hoặc `chờ gọi` nằm ở mục **Đang chờ** của trang nhập đơn và cuối email danh sách. Trên trang, mỗi đơn hiện đủ mã đơn, giờ đặt, tên, SĐT bấm gọi được, link liên hệ, món, số phần, cách nhận, khu vực và địa chỉ, tổng tiền, cách trả, lý do chờ kèm lý do cần gọi, ghi chú. Email chỉ có SĐT, số tiền và lý do. Các đơn này chưa được làm, nên cần có người xử lý.

**Xác nhận chuyển khoản:** hệ thống không đối soát ngân hàng và không tin ảnh chụp. Người kiểm tra mở app ngân hàng, xem tiền đã vào đúng số tiền và nội dung là mã đơn, rồi bấm **Đã nhận tiền** trên đơn ở mục **Đang chờ** và bấm xác nhận lần hai (hoặc đổi `Thanh toán` sang `da_nhan` trong Sheet). Trang không có nút hoàn tác: bấm nhầm thì sửa `Thanh toán` trong Sheet. Đơn sang Chuẩn bị ngay, và có trong email danh sách ở lần chạy lịch tiếp theo.

**Đơn chuyển khoản chưa trả tiền:** đơn này vẫn giữ suất cho đến khi huỷ. Nhóm tự chọn một thời hạn, ví dụ 2 giờ sau khi đặt, và báo trước cho khách. Hết hạn mà chưa thấy tiền thì liên hệ khách theo mục đang chờ, rồi đổi `Trạng thái` thành `huy` để trả lại suất. Hệ thống không tự huỷ. Nếu tiền đến sau khi đã huỷ, nhóm tự hoàn tiền hoặc tạo lại đơn nếu còn suất.

**SĐT từng bom:** đơn COD mới từ SĐT đã có đơn `bom` tự được đánh dấu `Cần gọi` ở mọi kênh, với lý do ghi mã đơn bom trước đó, và chỉ vào danh sách sau khi tích `Đã gọi`. Đơn chuyển khoản không bị đánh dấu.

**Email:** mọi email là văn bản thuần, tiêu đề có một biểu tượng để lọc nhanh và nói số việc. Dòng đầu chỉ có khi có việc cần làm ngay; việc cần làm ghi ngay trên dòng của từng đơn.

| Email | Tiêu đề |
|---|---|
| Đơn mới | `🔔 3 đơn mới · 7 phần · 1 cần gọi` |
| Danh sách | `📋 Cần chuẩn bị 12 phần · giao 5 điểm`, thêm số đơn tự lấy và đang chờ khi có |
| Báo cáo 22h | `📊 Hôm nay: 48 phần · 2.352.000đ` |
| Sắp hết suất | `⚠️ Còn 50 phần cuối` |
| Cấu hình lỗi | `⚠️ Tab Cấu hình đang có ô sai` |
| Đơn dự phòng lỗi | `⚠️ 1 đơn từ form dự phòng chưa nhận được` |

**Email danh sách** chỉ gửi khi nội dung khác lần đã gửi trước đó, kể cả khi danh sách vừa hết đơn. Muốn xem ngay thì dùng tab Danh sách ở trang nhập đơn; xem không ảnh hưởng email.

**Báo cáo:** mục hôm nay tính các đơn **tạo** trong ngày theo giờ Việt Nam, vì Sheet không lưu thời điểm đổi trạng thái. Đơn hôm qua giao xong hôm nay được tính vào mục cả đợt và vào ngày tạo.

**Đơn đặt sau 22h:** báo cáo gửi lúc 22h nên chưa có các đơn này. Báo cáo hôm sau chỉ tính chúng trong mục cả đợt, không có trong mục hôm nay của ngày nào. Vì vậy cộng các mục hôm nay lại có thể nhỏ hơn số cả đợt. Đối chiếu tiền và số phần theo số cả đợt.

| Số liệu | Cách tính |
|---|---|
| Số phần | Mọi đơn trừ `huy` |
| Tỷ lệ bom | Phần `bom` / (phần `bom` + phần `xong`); chưa có thì 0% |
| Doanh thu đã thu | `Tổng` của đơn `cod` đã `xong`, cộng đơn `da_nhan` không `huy` |
| Phần còn lại | `max_cups` trừ số phần cả đợt |

**Tab `Cấu hình`:** đọc cột `Ý nghĩa`, sửa cột `Giá trị`. Đổi được ngay, không cần deploy lại. Cột `Khoá` bị ẩn và có cảnh báo khi sửa, vì hệ thống tìm từng dòng theo cột này; đừng sửa hay xoá. Bảng dưới và các mục khác gọi mỗi dòng theo khoá, muốn đối chiếu thì bấm mũi tên ở vị trí cột ẩn để xem. Chạy `setup` không ghi đè `Ý nghĩa` nhóm đã tự sửa.

| Khoá | Ý nghĩa | Mặc định |
|---|---|---|
| `orders_open` | Ô chọn **Mở cửa** / **Đóng cửa**. Chọn Đóng cửa để tạm dừng mọi kênh đặt hàng; đơn Form vào `Đơn lỗi`. Ô xanh nhạt khi mở, đỏ nhạt khi đóng | Mở cửa |
| `unit_label` | Đơn vị đếm hiện trên trang nhập đơn, email và danh sách, ví dụ `phần`, `hộp`, `suất`. Trống thì dùng `phần` | phần |
| `max_cups` | Giới hạn tổng số phần trong đợt bán, ít nhất 1 | 600 |
| `low_stock_alert_cups` | Đạt số phần này thì gửi một email cảnh báo; 0 là tắt | 550 |
| `call_threshold_cups` | Đơn COD từ số phần này trở lên cần gọi, ít nhất 1 | 5 |
| `max_cups_per_phone_public` | Số phần tối đa một SĐT đặt qua landing và Form dự phòng, tính chung, ít nhất 1; trang nhập đơn không bị giới hạn | 10 |
| `shipping_fee_tu_lay`, `shipping_fee_trong_2km`, `shipping_fee_den_10km` | Phí ship | 0, 0, 10.000 |
| `shop_address` | Điểm xuất phát của mọi link bản đồ. Để trống thì Maps dùng vị trí của người giao | Trống |
| `maps_max_stops` | Số điểm giao tối đa mỗi link, không kể điểm xuất phát. Tối đa 10 | 4 |
| `bank_code` | Mã ngân hàng theo VietQR, ví dụ `vcb` hoặc mã BIN `970436` | Trống |
| `bank_account` | Số tài khoản nhận tiền | Trống |
| `bank_account_name` | Tên chủ tài khoản | Trống |

Số `550` và `10` là số tạm, nhóm tự chọn lại. Sheet cũ đang ghi `TRUE`/`FALSE` ở ô Nhận đơn vẫn chạy đúng; chạy `setup` để đổi sang chữ. Giá trị khác **Mở cửa** được coi là **Đóng cửa**, để lỗi gõ không vô tình mở bán.

**Khi ô `Cấu hình` sai:** các ô số có kiểm tra dữ liệu, nên Google từ chối ngay khi gõ chữ hoặc số âm. Ô vẫn có thể bị xoá trống hoặc dán giá trị sai. Khi đó:

- Nếu ô đó từng có giá trị hợp lệ, hệ thống dùng giá trị hợp lệ gần nhất, **vẫn nhận đơn**, và gửi một email `⚠️ Tab Cấu hình đang có ô sai` nêu tên ô và giá trị đang dùng, ví dụ "Ô "Phí ship đến 10km" đang trống. Hệ thống tạm dùng giá trị cũ: 10.000đ." Email này đi cùng lần chạy `order-notify` kế tiếp, nên cần workflow đang chạy.
- Mỗi lỗi chỉ được báo một lần. Sửa xong ô đó thì hệ thống dùng ngay giá trị mới và xoá cảnh báo; nếu sau đó có ô khác sai, hoặc cùng ô sai lại, sẽ có email mới.
- Nếu ô đó chưa từng có giá trị hợp lệ, ví dụ Sheet mới để trống, hệ thống từ chối đơn (`SERVER_ERROR`) như trước. Đặt thử một đơn sau khi điền `Cấu hình` lần đầu.

Cách xử lý khi nhận email cảnh báo: mở tab `Cấu hình`, sửa đúng ô được nêu, rồi đặt thử một đơn hoặc mở trang nhập đơn để chắc số đã đúng. Giá trị hợp lệ gần nhất lưu trong thuộc tính `CONFIG_LAST_GOOD`, không cần sửa tay.

**`maps_max_stops`:** tài liệu Google chỉ cam kết 3 điểm dừng giữa đường cộng điểm đích khi link mở trên trình duyệt điện thoại, và 9 cộng điểm đích ở nơi khác. Vì vậy mặc định là 4. Chỉ tăng sau khi thử trên điện thoại người giao mà link vẫn mở đủ điểm. Link cũng tự tách khi địa chỉ quá dài. Mỗi link đều đi từ `shop_address`, người giao tự sắp thứ tự.

**Chuyển khoản:** thiếu một trong ba khoá ngân hàng thì landing không nhận chuyển khoản, còn trang nhập đơn vẫn lưu được đơn nhưng không có QR. Các ô này đã để dạng chữ nên số 0 đầu không mất; kiểm tra lại số tài khoản sau khi gõ. QR dùng dịch vụ ảnh của VietQR (`img.vietqr.io`), nên số tài khoản, tên và số tiền đi qua dịch vụ đó. Đổi tài khoản chỉ có tác dụng với đơn mới; đơn cũ giữ QR đã cấp.

**Tab `Món`, `Topping`:** dữ liệu trong đó là mẫu, hãy thay bằng menu thật trước ngày bán. Đổi `Trạng thái` thành `inactive` để ngừng bán. Cột `Giá` hiện dấu phân cách hàng nghìn, còn giá trị vẫn là số. Giá sai định dạng thì món đó không hiện trên menu. Giá topping tính trên mỗi phần. Không đặt trùng tên món, vì Form dự phòng nhận món theo tên.

**Gõ giá và phí ship bằng chữ số liền nhau**, ví dụ `49000`, không gõ `49.000`. Tuỳ cài đặt vùng của Sheet, `49.000` có thể bị hiểu là 49. Giá món từ 1 đến 999đ được coi là gõ sai nên món bị ẩn. Phí ship từ 1 đến 999đ cũng bị coi là sai: hệ thống dùng phí hợp lệ gần nhất và gửi email cảnh báo như trên.

**Tab `Đơn lỗi`:** đơn Form không tạo được. Cột `Lý do` cho biết vì sao không tạo được đơn, cột `Nội dung` là câu trả lời của khách, cột `Đã báo` có giờ nghĩa là đã email. Xử lý xong có thể xoá dòng.

**Khi đơn giả chiếm hết suất:**

1. Đổi ô Nhận đơn sang **Đóng cửa** để chặn đơn mới.
2. Trong `Đơn hàng`, đổi `Trạng thái` của các đơn giả thành `huy`. Suất được trả lại ngay.
3. Đổi ô Nhận đơn về **Mở cửa** để mở lại.

**Dữ liệu khách:** chỉ chia sẻ Sheet cho nhóm vận hành. Email danh sách, email đơn mới và email đơn lỗi có SĐT và địa chỉ, chỉ gửi vào địa chỉ của nhóm. Sau đợt bán, xoá SĐT và địa chỉ khi không còn cần, gồm cả `Đơn lỗi` và tab **Câu trả lời** của Form.

## 8. Dành cho người làm trang

Hợp đồng đầy đủ nằm ở `_bmad-output/specs/spec-store-fnb-n8n-gian-tiep/order-data.md`. `landing-example.html` là ví dụ chạy được, nhưng phải đổi ba giá trị ở đầu thẻ `<script>` trước khi dùng:

- `WEB_APP_URL`: URL `/exec` ở mục 3
- `MESSENGER_URL`: link Messenger của page
- `DELIVERY_NOTE`: câu báo thời gian giao, hiện sau khi đặt xong

- Lấy cấu hình: `GET <URL>`.
- Gửi đơn: `POST <URL>` với `Content-Type: text/plain`, thân là JSON, để tránh CORS preflight.
- Tạo `submission_id` một lần cho mỗi lần đặt và giữ nguyên khi thử lại.
- Khoá nút Đặt trong khi chờ.
- `payment_method` là `cod` hoặc `chuyen_khoan`. Chỉ hiện lựa chọn chuyển khoản khi cấu hình trả `transfer_enabled: true`; nếu không, server trả `INVALID_INPUT`.
- Đơn chuyển khoản trả thêm `transfer: { qr_url, amount, content, bank_code, bank_account, bank_account_name }`. Ba trường cuối được thêm so với `order-data.md`, các trường cũ không đổi. Gửi lại cùng `submission_id` trả đúng `transfer` cũ.
- Hiện ảnh từ `qr_url`, link mở ảnh đó, ngân hàng, số tài khoản, tên tài khoản, số tiền và nội dung, vì khách đặt trên điện thoại không quét được QR trên chính máy đó. `bank_code` là mã trong `Cấu hình`, có thể là tên viết tắt hoặc mã BIN. Ảnh lỗi thì báo rõ và mời chuyển theo thông tin chữ. Nói rõ đơn được làm sau khi nhóm xác nhận đã nhận tiền.
- `SOLD_OUT` dùng cho cả hết suất và tạm đóng đơn.
- `orders_open` trong cấu hình vẫn là `true`/`false`, dù trong Sheet ghi Mở cửa/Đóng cửa.
- Luôn dùng `ok`, `error_code` trong JSON để biết kết quả. HTTP luôn trả 200.
- Hiển thị dữ liệu bằng `textContent`, không dùng `innerHTML`.

## 9. Chạy test

```
wsl -d Ubuntu --cd /mnt/c/Dev/StoreN8NSupport/store-ops -- node --test tests/
```

Test dùng Sheets, Lock, Properties, Form giả, không chạm tài khoản Google. Mọi đơn test đều nằm trong bộ nhớ. Test không kiểm tra được Form thật, QR thật, link Maps trên điện thoại, email thật và giao diện trang nhập đơn trên trình duyệt; các phần đó nằm ở mục 6.

## 10. Xử lý sự cố

| Hiện tượng | Xem ở đâu |
|---|---|
| Trang báo lỗi hệ thống (`SERVER_ERROR`) | Apps Script → **Lần thực thi**. Thường do `Cấu hình` có ô trống hoặc sai mà chưa từng có giá trị hợp lệ, hoặc chưa chạy `setup` |
| Nhận email `⚠️ Tab Cấu hình đang có ô sai` | Sửa đúng ô được nêu trong tab `Cấu hình`. Trong lúc đó hệ thống vẫn nhận đơn với giá trị cũ |
| Trang nhập đơn báo "Link này không còn dùng được" | `STAFF_KEY` đã đổi; xin link mới từ quản lý |
| Trang nhập đơn hiện Đang đóng cửa dù muốn mở | Ô Nhận đơn trong `Cấu hình` phải đúng **Mở cửa**; mọi giá trị khác tính là đóng. Bấm **Làm mới** sau khi đổi |
| Mục Cài đặt báo "Nhập sai quá nhiều lần, thử lại sau 10 phút." | Chờ 10 phút. Nếu cần mở ngay, quản lý xoá thuộc tính `MANAGER_LOCKED_UNTIL` trong Apps Script |
| Mục Cài đặt báo cần đặt mật khẩu | Thêm thuộc tính `MANAGER_PASSWORD` ở mục 2 |
| Cài đặt báo "Tab Cấu hình chưa có dòng này" | Chạy `setup` để thêm dòng còn thiếu |
| Không có email báo đơn | n8n → **Executions**, node nào đỏ. Kiểm tra workflow đã Publish và cột ẩn `Đã báo` còn trống |
| `UNAUTHORIZED` trong n8n | Giá trị Query Auth phải trùng `N8N_KEY`, tên phải là `key` |
| Lỗi đăng nhập SMTP | Tạo lại mật khẩu ứng dụng, dán không có dấu cách |
| Sửa code nhưng không thấy đổi | Chưa tạo **Phiên bản mới** ở mục 3 |
| Google báo thiếu quyền khi chạy `setupBackupForm` | Kiểm tra `appsscript.json` đã dán bản mới, chạy lại rồi cấp quyền |
| Khách gửi Form nhưng không có đơn, không có dòng `Đơn lỗi` | Apps Script → **Trình kích hoạt** và **Lần thực thi**. Phản hồi vẫn nằm trong Form; chạy lại `setupBackupForm` nếu mất trigger, rồi nhập tay các đơn đã lỡ ở trang nhập đơn |
| Landing không có lựa chọn chuyển khoản | Thiếu hoặc sai `bank_code`, `bank_account`, `bank_account_name`. Hai ô đầu chỉ nhận chữ và số |
| QR quét ra sai tài khoản hoặc app không đọc được | Kiểm tra `bank_code` theo danh sách của VietQR và số tài khoản còn đủ số 0 đầu |
| Link bản đồ mở thiếu điểm | Giảm `maps_max_stops` |
| Có đổi đơn nhưng không có email danh sách | Ngoài giờ 8h đến 21h, hoặc thay đổi không ảnh hưởng nội dung danh sách. Xem ở tab Danh sách trên trang nhập đơn |
| Email đơn cần gọi không ghi lý do | Đơn tạo trước khi chạy `setup` bản Trân châu nắng, hoặc tab `Đơn hàng` chưa có cột `Lý do gọi`. Chạy `setup` |
| Có cả tab tên cũ và tên mới, ví dụ `Orders` và `Đơn hàng` | Hệ thống dùng tab tên mới và không đụng tab cũ. Kiểm tra đơn ở tab nào, chuyển tay nếu cần, rồi tự xoá tab thừa |
| Sau khi chạy `setup`, trang và n8n báo `SERVER_ERROR` | Web app còn chạy phiên bản cũ. Tạo **Phiên bản mới** ở mục 3 |
| Một cột vẫn giữ tiêu đề tiếng Anh sau khi chạy `setup` | Đã có cột khác dùng đúng nhãn đó, xem **Nhật ký thực thi**. Hệ thống vẫn chạy đúng; đổi tên cột của nhóm rồi chạy lại `setup` |
| `setupBackupForm` báo không mở được Form | Làm theo mục 4b. Không xoá `BACKUP_FORM_ID` nếu chưa chắc muốn đổi link |
