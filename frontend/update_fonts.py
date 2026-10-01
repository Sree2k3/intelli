"import os
import re

def replace_font_classes(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # We want to replace patterns like:
    # font-black uppercase tracking-widest
    # uppercase font-bold tracking-[0.2em]
    # font-bold text-muted-foreground uppercase
    
    # Let's replace 'font-black' or 'font-bold' with 'font-medium'
    # IF it is in the same class string as 'uppercase'
    
    def repl(match):
        class_str = match.group(1)
        if 'uppercase' in class_str:
            # replace font-black and font-bold with font-medium
            class_str = re.sub(r'\bfont-black\b', 'font-medium', class_str)
            class_str = re.sub(r'\bfont-bold\b', 'font-medium', class_str)
            
            # optionally change extreme tracking to tracking-wider
            class_str = re.sub(r'\btracking-widest\b', 'tracking-wider', class_str)
            class_str = re.sub(r'\btracking-\[.*?\]\b', 'tracking-wider', class_str)
            
            # replace text-zinc-400 with text-muted-foreground if uppercase
            class_str = re.sub(r'\btext-zinc-400\b', 'text-muted-foreground', class_str)
            class_str = re.sub(r'\btext-zinc-500\b', 'text-muted-foreground', class_str)
            
        return 'className="' + class_str + '"'
    
    def repl_template(match):
        class_str = match.group(1)
        if 'uppercase' in class_str:
            class_str = re.sub(r'\bfont-black\b', 'font-medium', class_str)
            class_str = re.sub(r'\bfont-bold\b', 'font-medium', class_str)
            class_str = re.sub(r'\btracking-widest\b', 'tracking-wider', class_str)
            class_str = re.sub(r'\btracking-\[.*?\]\b', 'tracking-wider', class_str)
            class_str = re.sub(r'\btext-zinc-400\b', 'text-muted-foreground', class_str)
            class_str = re.sub(r'\btext-zinc-500\b', 'text-muted-foreground', class_str)
        return 'className={`' + class_str
<truncated 658 bytes>