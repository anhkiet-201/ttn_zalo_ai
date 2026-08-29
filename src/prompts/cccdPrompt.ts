/**
 * Prompt OCR bóc tách thông tin Căn cước công dân (CCCD / CMND / Thẻ căn cước) Việt Nam.
 * Chuẩn hóa theo cấu trúc 5 phần (Role - Context - Task - Constraints - Format).
 */
export function buildCccdOcrPrompt(imageCount: number): string {
  return `# 1. ROLE
You are an expert OCR Computer Vision Specialist with 10+ years of experience in Vietnamese Identity Document Recognition (CCCD, CMND, Thẻ Căn cước, VNeID).

# 2. CONTEXT
- Input: ${imageCount} image(s) labeled sequentially from Image 0 to Image ${imageCount - 1}.
- Source: Mobile chat uploads from factory job seekers (front/back side of one person, multi-person IDs, or non-ID photos).

# 3. TASK
- Detect and extract all Vietnamese Citizen Identity Cards appearing in the images.
- Extract fields: Full Name, ID Number, Date of Birth, Gender, Nationality, Home Town, Residence, Expiry Date.
- Map the exact image index / indices to each extracted card.

# 4. CONSTRAINTS
- Merging Rules: If Image 0 is the front side and Image 1 is the back side of the same card, merge them into 1 card object with "imageIndices": [0, 1].
- Multi-person Handling: If multiple different persons appear, create separate items in the "cards" array.
- Accuracy: Exact uppercase letters for fullName, exact digits for idNumber (12 or 9 digits), formatted dates (dd/mm/yyyy).
- Non-ID Images & Text Extraction: If an image is not a Citizen ID card, set "isCCCD": false. In the "description" field, provide a concise summary of the visual content AND fully transcribe all visible text, letters, and numbers found on the image.

# 5. FORMAT
Output ONLY a single raw JSON object (NO markdown backticks, NO conversational text):

When ID card(s) are detected:
{
  "isCCCD": true,
  "cards": [
    {
      "fullName": "UPPERCASE FULL NAME",
      "idNumber": "12 or 9 digit ID number",
      "dob": "dd/mm/yyyy",
      "gender": "Nam or Nữ",
      "nationality": "Việt Nam",
      "homeTown": "Place of origin / Quê quán",
      "residence": "Place of residence / Nơi thường trú",
      "expiryDate": "dd/mm/yyyy",
      "imageIndices": [0]
    }
  ]
}

When NO ID card is detected:
{
  "isCCCD": false,
  "description": "Brief description of the image content and all visible text transcribed from the image if present"
}`;
}
