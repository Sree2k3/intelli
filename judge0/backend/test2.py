import traceback
lines = open('output.txt', 'r', encoding='utf-16le').readlines()
with open('debug_output.txt', 'w', encoding='utf-8') as f:
    f.writelines(lines)
