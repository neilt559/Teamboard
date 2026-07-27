@echo off
cd /d "%~dp0"
echo ============================================================
echo   Uploading TeamBoard to your GitHub repo
echo ============================================================
echo.
echo A GitHub sign-in window may open in your web browser.
echo If it does, just log in / click Authorize. That's normal.
echo.
git push -u origin main
echo.
echo ============================================================
if %errorlevel%==0 (
  echo   SUCCESS - your code is now on GitHub!
  echo   Next: import the repo in Vercel. Tell Claude "it worked".
) else (
  echo   Something went wrong above. Take a screenshot of this
  echo   window and send it to Claude.
)
echo ============================================================
echo.
pause
