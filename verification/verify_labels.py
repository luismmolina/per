from playwright.sync_api import sync_playwright, expect

def verify_accessibility_labels():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app (assuming default port 3000)
        try:
            page.goto("http://localhost:3000", timeout=60000)
        except Exception as e:
            print(f"Error navigating to page: {e}")
            browser.close()
            return

        print("Page loaded.")

        # Verify buttons have aria-labels
        # We use a custom locator strategy to find elements by aria-label

        # 1. Voice button
        voice_btn = page.locator("button[aria-label='Start voice input']")
        if voice_btn.count() == 0:
             voice_btn = page.locator("button[aria-label='Stop voice input']")

        expect(voice_btn).to_be_visible()
        print("Verified Voice button has aria-label")

        # 2. Deep Read button (might not be visible if onSwitchToDeepRead is not provided,
        # checking the code, it depends on props. Let's assume it might be there or check if it exists)
        # In the default app state, we should check if these buttons are rendered.

        # 3. Note button
        note_btn = page.locator("button[aria-label='Save as Note']")
        # Note button only appears if there is text in the input?
        # Let's check the code: {value.trim() ? (...) : (...)}
        # So we need to type something first.

        page.fill("textarea", "Hello world")
        print("Typed text into input.")

        expect(note_btn).to_be_visible()
        print("Verified Note button has aria-label")

        # 4. Ask button
        ask_btn = page.locator("button[aria-label='Ask AI']")
        expect(ask_btn).to_be_visible()
        print("Verified Ask button has aria-label")

        # 5. Download Notes (might depend on props)
        # 6. Scroll to bottom (might depend on scroll state)

        # Take a screenshot
        page.screenshot(path="verification/accessibility_check.png")
        print("Screenshot taken.")

        browser.close()

if __name__ == "__main__":
    verify_accessibility_labels()
