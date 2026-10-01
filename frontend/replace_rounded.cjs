const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

let updatedCount = 0;

walkDir('./src', function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace rounded-xl, rounded-2xl, rounded-3xl, rounded-lg, rounded-[arbitrary] with rounded-md
    let newContent = content.replace(/\brounded-(xl|2xl|3xl|lg|\[[^\]]+\])\b/g, 'rounded-md');
    
    // Replace specific sided rounded classes like rounded-t-2xl, rounded-tl-[1rem]
    newContent = newContent.replace(/\brounded-(t|r|b|l|tl|tr|bl|br)-(xl|2xl|3xl|lg|\[[^\]]+\])\b/g, 'rounded-$1-md');
    
    if (content !== newContent) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      updatedCount++;
    }
  }
});

console.log(`Updated ${updatedCount} files.`);
