# 居屋 2025 選樓觀察站

啟陽苑及影輝苑的選樓儀表版。解析房委會公開的五份狀況 PDF，按屋苑／座別／實用面積類別顯示單位、優先計劃配額及更新歷史。非房委會官方網站，選樓時以官方資料為準。

## 本機預覽

需要 Python 3.11+、Node.js（用於前端測試）及可選的虛擬環境：

```sh
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
python scripts/update_data.py
python scripts/build_factsheets.py
python -m http.server 8000 --directory web
```

打開 `http://localhost:8000`。`update_data.py` 可加 `--pdf-dir <目錄>`，以五份同名的官方 PDF 作離線驗證，不會覆蓋原始來源。每次執行會核對從彩色方格計算的未售單位數是否與 PDF 列示數字相同；任何來源失效或數字不符都會停止更新，保留上一次已發布版本。

```sh
python -m unittest discover -s tests
node --test tests/test_model.mjs
```

## 免費公開部署

將專案推到 GitHub `main`，到 repository **Settings → Pages → Build and deployment** 選 **GitHub Actions**。`.github/workflows/publish.yml` 會於 push、手動觸發及約每 15 分鐘的排程執行，解析資料、記錄公開快照、渲染售樓說明書節錄並部署 `web/`。只有官方 PDF 實際改變才會提交快照到 `main`；沒有變更時仍會發布新檢查時間，不會增加 Git 提交。GitHub 排程可能延遲；請以頁面上的「資料擷取」及各 PDF「官方更新」時間判斷新舊。Actions 需具備 `contents: write` 權限以提交狀態檔；如果 repository 禁止 workflow 寫入，請於 **Settings → Actions → General → Workflow permissions** 啟用 read/write。

「讀取最新已發布資料」只重新讀取部署的 JSON，不會立即抓取官方 PDF；同一瀏覽器一分鐘內不能再按。網站每 15 分鐘自動檢查已發布版本。需要即時向房委會抓取 PDF 時，必須另建可執行程式的後端。

個人申請編號及選樓時間只存在本機瀏覽器的 `localStorage`，不會提交到 GitHub 或放在靜態檔案。於「私人選樓坐標」手動填入資料：優先屋苑、偏好樓層、兩苑各自不偏好的樓層（範圍與單層可用逗號分隔，例如 `8-10, 32`），及每行一個座別的排序（例：`啟陽 A: 1 > 2 = 3`）。同一屋苑跨行由上至下排序。清除瀏覽器網站資料可移除私人設定。

「複製喜好連結」只在主動點擊後將喜好及目前的面積篩選放進 URL 參數；**不包含申請編號或選樓時段**。分享連結可能保留在接收者的瀏覽紀錄或伺服器日誌，請只分享給你信任的人。打開連結會先預覽喜好，不會自動覆蓋本機 `localStorage`；點擊「儲存在此瀏覽器」才會保存。

## 資料定義

- `web/data/latest.json`：最近一次檢查結果，包括優先計劃的**全苑配額**與四座各自的**未售單位**。兩種數字不可相加或混用。
- `web/data/history.json`：最近 30 天實際有變更的版本差異。一小時配額差額依首次記錄和事件時間重建；記錄未夠一小時時不顯示 delta。
- 可選面積類別按各座 PDF 圖例的實用面積範圍分類；深色代表較大單位。已售／已選單位於原表格不標示面積類別，網站也不推斷。
- 面積篩選掣上的數字為啟陽苑及影輝苑四座的各類別未售單位總數，不受目前選中哪些篩選掣影響；翻查歷史版本時改為該版本的數字。
- 「較值得留意」依照你的喜好、目前可選樓層及近期單位變化排列，不等於保證或精確的成功機率。

官方狀況 PDF 來源見 `scripts/update_data.py`；原始售樓說明書節錄置於 `docs/factsheet/`，發佈時才產生 `web/assets/` 的圖片與 `web/brochures/` 的可下載副本。