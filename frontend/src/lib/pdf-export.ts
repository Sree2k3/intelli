import { jsPDF } from "jspdf";

// Helper class to manage PDF document construction, page wrapping, and layout styling
class PDFGenerator {
  doc: jsPDF;
  y: number = 20;
  margin: number = 20;
  pageWidth: number = 210;
  pageHeight: number = 297;
  contentWidth: number = 170;

  constructor(filename: string) {
    this.doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
  }

  ensureSpace(neededHeight: number) {
    if (this.y + neededHeight > this.pageHeight - this.margin) {
      this.doc.addPage();
      this.y = this.margin;
      this.drawPageHeader();
    }
  }

  drawPageHeader() {
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(8);
    this.doc.setTextColor(148, 163, 184); // slate-400
    this.doc.text("IntelliHire AI Interview Platform — Confidential Report", this.margin, this.y - 8);
    
    this.doc.setDrawColor(241, 245, 249); // slate-100
    this.doc.setLineWidth(0.2);
    this.doc.line(this.margin, this.y - 6, this.margin + this.contentWidth, this.y - 6);
  }

  drawTitle(title: string, subtitle?: string) {
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(20);
    this.doc.setTextColor(15, 23, 42); // slate-900
    this.doc.text(title, this.margin, this.y);
    this.y += 6;

    if (subtitle) {
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(10);
      this.doc.setTextColor(100, 116, 139); // slate-500
      this.doc.text(subtitle, this.margin, this.y);
      this.y += 8;
    }

    this.doc.setDrawColor(226, 232, 240); // slate-200
    this.doc.setLineWidth(0.5);
    this.doc.line(this.margin, this.y, this.margin + this.contentWidth, this.y);
    this.y += 10;
  }

  drawSectionTitle(title: string) {
    this.ensureSpace(16);
    this.y += 2;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(13);
    this.doc.setTextColor(30, 41, 59); // slate-800
    this.doc.text(title, this.margin, this.y);
    this.y += 4;

    this.doc.setDrawColor(241, 245, 249); // slate-100
    this.doc.setLineWidth(0.3);
    this.doc.line(this.margin, this.y, this.margin + this.contentWidth, this.y);
    this.y += 6;
  }

  drawMetadataRow(label: string, value: string, nextColX?: number, nextLabel?: string, nextVal?: string) {
    this.ensureSpace(8);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9);
    this.doc.setTextColor(71, 85, 105); // slate-600
    this.doc.text(label + ":", this.margin, this.y);
    
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(15, 23, 42); // slate-900
    this.doc.text(value || "N/A", this.margin + 32, this.y);

    if (nextColX && nextLabel && nextVal) {
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(71, 85, 105);
      this.doc.text(nextLabel + ":", nextColX, this.y);
      
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(15, 23, 42);
      this.doc.text(nextVal || "N/A", nextColX + 28, this.y);
    }
    
    this.y += 6;
  }

  drawScoreBadge(label: string, score: number | null | undefined, x: number, y: number, w: number, h: number, isOverall: boolean = false) {
    const scoreStr = score !== null && score !== undefined ? `${Math.round(score)}/100` : "N/A";
    
    // Draw card background
    this.doc.setFillColor(isOverall ? 239 : 248, isOverall ? 246 : 250, isOverall ? 255 : 252); // light blue for overall, slate gray otherwise
    this.doc.setDrawColor(isOverall ? 191 : 226, isOverall ? 219 : 232, isOverall ? 254 : 240); // blue border vs slate border
    this.doc.setLineWidth(0.3);
    this.doc.roundedRect(x, y, w, h, 2, 2, "FD");

    // Draw label text
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(8);
    this.doc.setTextColor(100, 116, 139); // slate-500
    this.doc.text(label.toUpperCase(), x + 4, y + 5);

    // Draw score text
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(14);
    this.doc.setTextColor(isOverall ? 29 : 15, isOverall ? 78 : 23, isOverall ? 216 : 42); // primary blue vs slate-900
    this.doc.text(scoreStr, x + 4, y + 12);
  }

  drawBullets(title: string, items: string[], themeColor: [number, number, number]) {
    this.ensureSpace(12 + items.length * 6);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(10);
    this.doc.setTextColor(themeColor[0], themeColor[1], themeColor[2]);
    this.doc.text(title, this.margin, this.y);
    this.y += 5;

    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9.5);
    this.doc.setTextColor(51, 65, 85); // slate-700

    items.forEach((item) => {
      const wrapped = this.doc.splitTextToSize(item, this.contentWidth - 6);
      const rowHeight = wrapped.length * 4.5 + 1;
      this.ensureSpace(rowHeight);
      
      // Draw bullet point dot
      this.doc.setFillColor(themeColor[0], themeColor[1], themeColor[2]);
      this.doc.circle(this.margin + 2, this.y - 1.2, 1, "F");
      
      wrapped.forEach((line: string) => {
        this.doc.text(line, this.margin + 6, this.y);
        this.y += 4.5;
      });
      this.y += 1;
    });
    this.y += 3;
  }

  drawParagraphBox(text: string, title?: string) {
    const fontSize = 9.5;
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(fontSize);
    this.doc.setTextColor(51, 65, 85); // slate-700
    
    const safeText = text !== null && text !== undefined ? String(text) : "";
    const lines = this.doc.splitTextToSize(safeText, this.contentWidth - 8);
    const boxHeight = lines.length * 4.5 + (title ? 10 : 6);
    
    this.ensureSpace(Math.min(boxHeight + 4, 60));
    
    // Draw box background
    this.doc.setFillColor(248, 250, 252); // slate-50
    this.doc.setDrawColor(241, 245, 249); // slate-100
    this.doc.setLineWidth(0.3);
    this.doc.roundedRect(this.margin, this.y, this.contentWidth, boxHeight, 2, 2, "FD");
    
    let innerY = this.y + 5;
    
    if (title) {
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(9);
      this.doc.setTextColor(100, 116, 139); // slate-500
      this.doc.text(title.toUpperCase(), this.margin + 4, innerY);
      innerY += 5;
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(fontSize);
      this.doc.setTextColor(51, 65, 85);
    }
    
    lines.forEach((line: string) => {
      if (innerY > this.pageHeight - this.margin - 4) {
        this.doc.addPage();
        this.y = this.margin;
        this.drawPageHeader();
        innerY = this.margin + 5;
        this.doc.setFont("helvetica", "normal");
        this.doc.setFontSize(fontSize);
        this.doc.setTextColor(51, 65, 85);
      }
      this.doc.text(line, this.margin + 4, innerY);
      innerY += 4.5;
    });
    
    this.y = Math.max(this.y + boxHeight + 4, innerY + 2);
  }

  save(filename: string) {
    this.doc.save(filename);
  }
}

// Function 1: Export Full Interview Results Scorecard (Q&A Transcript + Code Submissions)
export function exportResultsPDF(
  interview: any,
  evaluation: any,
  transcriptItems: any[]
) {
  const safeName = (interview?.candidate_name || "candidate").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeName}_scorecard.pdf`;
  const gen = new PDFGenerator(filename);
  
  // 1. Title & Header
  gen.drawTitle(
    "AI Interview Scorecard",
    `Candidate Assessment Report • Generated on ${new Date().toLocaleDateString()}`
  );

  // 2. Candidate Metadata Row
  gen.drawMetadataRow("Candidate Name", interview?.candidate_name || "N/A", 110, "Applied Role", interview?.job_role || "N/A");
  gen.drawMetadataRow("Email Address", interview?.candidate_email || "N/A", 110, "Assessment Date", interview?.created_at ? new Date(interview.created_at).toLocaleDateString() : "N/A");
  
  // Proctoring highlights
  let strikes = 0;
  if (interview?.proctoring_strikes) {
    for (const key in interview.proctoring_strikes) {
      const val = interview.proctoring_strikes[key];
      if (typeof val === 'number') {
        strikes += val;
      } else if (typeof val === 'string') {
        strikes += parseInt(val, 10) || 0;
      }
    }
  }
  const isFlagged = interview?.status === "flagged";
  const proctorStatus = isFlagged || strikes > 0 ? `Flagged (${strikes} Alerts)` : "Verified (No Alerts)";
  gen.drawMetadataRow(
    "Proctoring Status", 
    proctorStatus, 
    110, 
    "AI Recommendation", 
    evaluation?.recommendation || interview?.ai_recommendation || "Pending"
  );
  gen.y += 4;

  // 3. Score Grid Card Block
  gen.ensureSpace(20);
  const cardW = 38;
  const cardH = 16;
  const startX = gen.margin;
  
  gen.drawScoreBadge("Overall Score", evaluation?.overall_score ?? interview?.overall_score, startX, gen.y, cardW, cardH, true);
  gen.drawScoreBadge("Technical", evaluation?.technical_score ?? interview?.technical_score, startX + 44, gen.y, cardW, cardH);
  gen.drawScoreBadge("Behavioral", evaluation?.behavioral_score ?? interview?.behavioral_score, startX + 88, gen.y, cardW, cardH);
  
  const codingScore = evaluation?.coding_score ?? interview?.coding_score;
  gen.drawScoreBadge("Coding Round", codingScore !== undefined ? codingScore : null, startX + 132, gen.y, cardW, cardH);
  
  gen.y += 22;

  // 4. Evaluation Criteria Breakdown (if available)
  if (evaluation?.evaluation_rubric && Array.isArray(evaluation.evaluation_rubric) && evaluation.evaluation_rubric.length > 0) {
    gen.drawSectionTitle("Evaluation Criteria Breakdown");
    gen.ensureSpace(14 + evaluation.evaluation_rubric.length * 6);
    
    // Draw table header
    gen.doc.setFont("helvetica", "bold");
    gen.doc.setFontSize(8.5);
    gen.doc.setTextColor(100, 116, 139);
    gen.doc.text("EVALUATION CRITERION", gen.margin, gen.y);
    gen.doc.text("WEIGHT", gen.margin + 110, gen.y);
    gen.doc.text("SCORE", gen.margin + 145, gen.y);
    gen.y += 3;
    
    gen.doc.setDrawColor(226, 232, 240);
    gen.doc.setLineWidth(0.3);
    gen.doc.line(gen.margin, gen.y, gen.margin + gen.contentWidth, gen.y);
    gen.y += 4.5;

    evaluation.evaluation_rubric.forEach((param: any) => {
      gen.ensureSpace(7);
      const score = evaluation.rubric_summary?.[param.id] ?? 
        (param.id === "technical_correctness" ? evaluation.technical_score :
         param.id === "communication_quality" ? evaluation.behavioral_score :
         evaluation.overall_score) ?? 0;
      
      gen.doc.setFont("helvetica", "normal");
      gen.doc.setFontSize(9);
      gen.doc.setTextColor(15, 23, 42);
      gen.doc.text(String(param.name || param.id), gen.margin, gen.y);

      gen.doc.setFont("helvetica", "normal");
      gen.doc.setTextColor(100, 116, 139);
      gen.doc.text(`${param.weight ?? 0}%`, gen.margin + 110, gen.y);

      gen.doc.setFont("helvetica", "bold");
      const numScore = Number(score) || 0;
      if (numScore >= 70) {
        gen.doc.setTextColor(22, 163, 74); // green
      } else if (numScore >= 50) {
        gen.doc.setTextColor(37, 99, 235); // blue
      } else {
        gen.doc.setTextColor(225, 29, 72); // red
      }
      gen.doc.text(`${Math.round(numScore)}%`, gen.margin + 145, gen.y);
      gen.y += 5.5;
    });
    gen.y += 4;
  }

  // 5. Executive Summary
  const summary = interview?.structured_memory?.ai_summary || interview?.structured_memory?.summary || evaluation?.ai_summary || "No executive summary available.";
  gen.drawSectionTitle("AI Executive Summary");
  gen.drawParagraphBox(summary);

  // 6. Strengths & Weaknesses side by side
  const strengths = evaluation?.strengths || interview?.structured_memory?.strengths || ["No strengths recorded."];
  const weaknesses = evaluation?.weaknesses || interview?.structured_memory?.weaknesses || ["No development areas recorded."];
  
  gen.drawSectionTitle("Qualitative Analysis");
  gen.drawBullets("Key Strengths", strengths, [22, 163, 74]); // emerald-600
  gen.drawBullets("Development Areas", weaknesses, [225, 29, 72]); // rose-600

  // 7. Detailed Q&A Transcript
  // Normalize transcript items: if raw messages array was passed, automatically extract QA pairs
  let processedItems = transcriptItems || [];
  if (Array.isArray(processedItems) && processedItems.length > 0) {
    const hasQaOrCoding = processedItems.some((it) => it && (it.type === "qa" || it.type === "coding"));
    if (!hasQaOrCoding) {
      // Raw chat messages fallback: [{ role: 'ai', content: ... }]
      const normalized: any[] = [];
      let qIndex = 0;
      for (let i = 0; i < processedItems.length; i++) {
        const msg = processedItems[i];
        if (msg && (msg.role === "ai" || msg.role === "assistant")) {
          qIndex++;
          const nextMsg = processedItems[i + 1];
          const userMsg = nextMsg?.role === "user" ? nextMsg : null;
          const isIntro = msg.metadata?.is_intro || msg.metadata?.agent_metadata?.focusing_on === "intro";
          normalized.push({
            type: "qa",
            label: isIntro ? "Introduction" : `Question ${qIndex} — ${(msg.round || "technical").toUpperCase()}`,
            question: msg.content || "",
            answer: userMsg?.content || "(No response)",
          });
          if (userMsg) i++;
        }
      }
      processedItems = normalized;
    }
  }

  gen.drawSectionTitle("Detailed Interview Transcript");

  if (!processedItems || processedItems.length === 0) {
    gen.drawParagraphBox("No transcript responses or code submissions were recorded for this interview session.", "Status");
  } else {
    processedItems.forEach((item) => {
      if (item.type === "qa") {
        gen.ensureSpace(35);
        
        // Label header & score
        gen.doc.setFont("helvetica", "bold");
        gen.doc.setFontSize(8.5);
        gen.doc.setTextColor(37, 99, 235); // primary-600
        const scoreLabel = item.score !== null && item.score !== undefined ? ` • Score: ${Math.round(item.score)}/100` : "";
        gen.doc.text(`${(item.label || "QUESTION").toUpperCase()}${scoreLabel}`, gen.margin, gen.y);
        gen.y += 4.5;
        
        // Question Text
        const qText = item.question ? String(item.question) : "(Question text not available)";
        gen.doc.setFont("helvetica", "bold");
        gen.doc.setFontSize(9.5);
        gen.doc.setTextColor(15, 23, 42); // slate-900
        const wrappedQ = gen.doc.splitTextToSize(`Question: "${qText}"`, gen.contentWidth);
        wrappedQ.forEach((line: string) => {
          gen.ensureSpace(5);
          gen.doc.text(line, gen.margin, gen.y);
          gen.y += 4.5;
        });
        gen.y += 2;

        // Answer Text in slate card
        const ansText = `Answer: ${item.answer ? String(item.answer) : "(No response)"}`;
        gen.drawParagraphBox(ansText);

        // AI Question Feedback if available
        if (item.ai_feedback) {
          gen.drawParagraphBox(String(item.ai_feedback), "AI Question Feedback");
        }
      } else if (item.type === "coding") {
        gen.ensureSpace(45);
        
        // Coding Label header
        gen.doc.setFont("helvetica", "bold");
        gen.doc.setFontSize(8.5);
        gen.doc.setTextColor(13, 148, 136); // teal-600
        const diffStr = item.difficulty ? ` (${String(item.difficulty).toUpperCase()})` : "";
        gen.doc.text(`${(item.label || "CODING CHALLENGE").toUpperCase()}${diffStr}`, gen.margin, gen.y);
        gen.y += 4.5;
        
        // Challenge Description
        gen.doc.setFont("helvetica", "bold");
        gen.doc.setFontSize(9.5);
        gen.doc.setTextColor(15, 23, 42);
        gen.doc.text("Challenge Description:", gen.margin, gen.y);
        gen.y += 4.5;
        
        gen.doc.setFont("helvetica", "normal");
        gen.doc.setFontSize(9);
        gen.doc.setTextColor(71, 85, 105);
        const wrappedDesc = gen.doc.splitTextToSize(item.question ? String(item.question) : "No description provided.", gen.contentWidth);
        wrappedDesc.forEach((line: string) => {
          gen.ensureSpace(5);
          gen.doc.text(line, gen.margin, gen.y);
          gen.y += 4.5;
        });
        gen.y += 3;

        // Submission Details
        if (item.submission) {
          const submissionText = `Language: ${item.submission.language || "N/A"}\nTest Cases: ${item.submission.passed_tests ?? 0}/${item.submission.total_tests ?? 0} Passed\n\nCode Submitted:\n${item.submission.code || "(No code submitted)"}`;
          gen.drawParagraphBox(submissionText, "Candidate Code Response");
          
          if (item.submission.ai_feedback) {
            gen.drawParagraphBox(String(item.submission.ai_feedback), "AI Code Feedback");
          }
        } else {
          gen.drawParagraphBox("No solution submitted for this challenge.", "Submission Status");
        }
      }
    });
  }

  gen.save(filename);
}

// Function 2: Export Recruiter/Admin Executive Summary Report (from Admin Dashboard modal)
export function exportAdminReportPDF(reportData: any) {
  const filename = `${reportData.candidate_name || "candidate"}_ai_evaluation_report.pdf`;
  const gen = new PDFGenerator(filename);

  // 1. Title & Header
  gen.drawTitle(
    "AI Detailed Evaluation Report",
    `Recruitment Analytics Dashboard • Generated on ${new Date().toLocaleDateString()}`
  );

  // 2. Candidate Metadata Row
  gen.drawMetadataRow("Candidate Name", reportData.candidate_name, 110, "Applied Role", reportData.applied_role);
  gen.drawMetadataRow("Email Address", reportData.candidate_email, 110, "Assessment Date", reportData.interview_date ? new Date(reportData.interview_date).toLocaleDateString() : "N/A");
  gen.drawMetadataRow("Recruiter Assignee", reportData.recruiter_name, 110, "Manager Approver", reportData.manager_name);
  gen.y += 4;

  // 3. Score Grid Card Block
  gen.ensureSpace(20);
  const cardW = 38;
  const cardH = 16;
  const startX = gen.margin;
  
  gen.drawScoreBadge("Overall Score", reportData.interview_score, startX, gen.y, cardW, cardH, true);
  gen.drawScoreBadge("Technical", reportData.technical_score, startX + 44, gen.y, cardW, cardH);
  gen.drawScoreBadge("Behavioral", reportData.behavioral_score, startX + 88, gen.y, cardW, cardH);
  gen.drawScoreBadge("Coding Round", reportData.coding_score, startX + 132, gen.y, cardW, cardH);
  
  gen.y += 22;

  // 4. Executive Summary
  const summary = reportData.ai_summary || reportData.structured_memory?.ai_summary || reportData.structured_memory?.summary || "No executive summary available.";
  gen.drawSectionTitle("AI Executive Summary");
  gen.drawParagraphBox(summary);

  // 5. Strengths & Weaknesses lists
  const strengths = reportData.strengths || reportData.structured_memory?.strengths || ["No strengths recorded."];
  const weaknesses = reportData.weaknesses || reportData.structured_memory?.weaknesses || ["No development areas recorded."];
  
  gen.drawSectionTitle("Candidate Competencies");
  gen.drawBullets("Key Strengths & Core Skills", strengths, [22, 163, 74]); // emerald-600
  gen.drawBullets("Areas for Growth & Further Evaluation", weaknesses, [225, 29, 72]); // rose-600

  // 6. Security/Proctoring Warnings
  const hasSecurityAlerts = reportData.suspicious_activity_alerts && Object.values(reportData.suspicious_activity_alerts).some((v: any) => v > 0);
  if (hasSecurityAlerts) {
    gen.drawSectionTitle("Security & Proctoring Analysis");
    
    let proctoringText = "Proctoring flags were raised during the assessment round:\n\n";
    Object.entries(reportData.suspicious_activity_alerts).forEach(([alertType, count]) => {
      if ((count as number) > 0) {
        proctoringText += `• ${alertType.replace(/_/g, ' ').toUpperCase()}: ${count} incident(s)\n`;
      }
    });
    proctoringText += "\nNote: Please review the interview recording session to verify the flags.";
    
    gen.drawParagraphBox(proctoringText, "Security Warning Indicators");
  }

  // 7. Final Recommendation Box
  gen.drawSectionTitle("Interview Outcome Decision");
  const recommendation = reportData.recommendation || reportData.ai_recommendation || "Hire";
  const recommendationDesc = recommendation === "Hire" 
    ? "Based on the technical scorecard, positive communication capabilities, and high compliance rate, the candidate is RECOMMENDED for hire."
    : "Based on the assessment scoring breakdown and potential development areas or proctoring alerts, the candidate is NOT recommended for direct hiring at this stage.";
  
  gen.drawParagraphBox(recommendationDesc, `Recommendation: ${recommendation}`);

  gen.save(filename);
}
