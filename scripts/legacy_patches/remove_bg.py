from PIL import Image

def remove_black_background(input_path, output_path, tolerance=25):
    img = Image.open(input_path).convert("RGBA")
    pixels = img.load()
    width, height = img.size

    # BFS from corners
    corners = [(0, 0), (width-1, 0), (0, height-1), (width-1, height-1)]
    visited = set()
    queue = []
    
    for c in corners:
        queue.append(c)
        visited.add(c)
        
    def is_blackish(r, g, b, a):
        # check if it's close to black
        return r < tolerance and g < tolerance and b < tolerance
        
    while queue:
        x, y = queue.pop(0)
        r, g, b, a = pixels[x, y]
        
        if is_blackish(r, g, b, a):
            pixels[x, y] = (0, 0, 0, 0)
            
            for dx, dy in [(0, 1), (1, 0), (0, -1), (-1, 0)]:
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in visited:
                    visited.add((nx, ny))
                    queue.append((nx, ny))
                    
    img.save(output_path, "PNG")

remove_black_background(
    r"C:\Users\ASUS\.gemini\antigravity-ide\brain\68a0c571-72d3-4ee3-9340-32ef94a6002c\.user_uploaded\media_1791372331482.jpg",
    r"c:\Users\ASUS\Downloads\kada\vendor_web\public\logo.png"
)
