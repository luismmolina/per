
from playwright.sync_api import sync_playwright

def verify_chat_interface():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the local dev server
        # Assuming dev server is running on localhost:3000
        try:
            page.goto('http://localhost:3000')
        except:
            print('Could not connect to localhost:3000. Is the server running?')
            browser.close()
            return

        # Check for the existence of buttons with new aria-labels

        # 1. Check Voice button
        voice_btn = page.get_by_role('button', name='Start voice input')
        if voice_btn.count() > 0:
            print('SUCCESS: Voice button found with aria-label "Start voice input"')
        else:
            print('FAILURE: Voice button NOT found with aria-label "Start voice input"')

        # 2. Check Note button (hidden text 'Note', exposed aria-label 'Save as Note')
        # We need to type something first to make these buttons appear
        textarea = page.get_by_placeholder('Type or ask...')
        textarea.fill('Hello world')

        # Wait for animation
        page.wait_for_timeout(1000)

        note_btn = page.get_by_role('button', name='Save as Note')
        if note_btn.count() > 0:
            print('SUCCESS: Note button found with aria-label "Save as Note"')
        else:
            print('FAILURE: Note button NOT found with aria-label "Save as Note"')

        ask_btn = page.get_by_role('button', name='Ask AI')
        if ask_btn.count() > 0:
            print('SUCCESS: Ask button found with aria-label "Ask AI"')
        else:
            print('FAILURE: Ask button NOT found with aria-label "Ask AI"')

        # 3. Check Deep Read button (if visible)
        # It's conditional on 'onSwitchToDeepRead', assuming it's present in default view
        deep_read_btn = page.get_by_role('button', name='Open Deep Read')
        if deep_read_btn.count() > 0:
             print('SUCCESS: Deep Read button found with aria-label "Open Deep Read"')
        else:
             print('INFO: Deep Read button not found (might be conditional)')

        # Take a screenshot
        page.screenshot(path='verification/aria_labels_check.png')
        print('Screenshot saved to verification/aria_labels_check.png')

        browser.close()

if __name__ == '__main__':
    verify_chat_interface()
