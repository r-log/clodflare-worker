import { Octokit } from '@octokit/rest';
import Anthropic from '@anthropic-ai/sdk';
import { PullRequestJob, QualityCheckResult, Env } from '../types';

async function fetchPRContent(job: PullRequestJob, octokit: Octokit): Promise<string> {
  const [owner, repo] = job.repository.split('/');
  const { data: pullRequest } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: job.prNumber,
  });

  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: job.prNumber,
  });

  // Get the content of added/modified markdown files
  const markdownFiles = files.filter(file => 
    (file.status === 'added' || file.status === 'modified') &&
    file.filename.endsWith('.md')
  );

  if (markdownFiles.length === 0) {
    throw new Error('No markdown files found in the pull request');
  }

  // For now, we'll just check the first markdown file
  const file = markdownFiles[0];
  const { data: content } = await octokit.repos.getContent({
    owner,
    repo,
    path: file.filename,
    ref: pullRequest.head.sha,
  });

  if ('content' in content) {
    return Buffer.from(content.content, 'base64').toString();
  }

  throw new Error('Could not fetch file content');
}

async function validateWithClaude(
  content: string,
  anthropic: Anthropic
): Promise<QualityCheckResult> {
  const prompt = `Review this crypto attack article for quality and accuracy. Check for:
1. Clear description of the attack
2. Technical accuracy
3. Proper references
4. Formatting and structure
5. Completeness of information

Article content:
${content}

Provide a structured review with:
- Overall assessment (pass/fail)
- Detailed feedback
- Specific suggestions for improvement`;

  const message = await anthropic.messages.create({
    model: 'claude-3-opus-20240229',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: prompt,
    }],
  });

  const analysis = message.content[0].text;
  
  // Parse Claude's response
  const passed = analysis.toLowerCase().includes('pass');
  const suggestions = analysis
    .split('\n')
    .filter(line => line.trim().startsWith('-'))
    .map(line => line.trim().substring(2));

  return {
    passed,
    details: analysis,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

export async function runQualityChecks(
  job: PullRequestJob,
  env: Env,
  octokit: Octokit,
  anthropic: Anthropic
): Promise<QualityCheckResult[]> {
  try {
    // Fetch PR content
    const content = await fetchPRContent(job, octokit);
    
    // Run checks
    const results: QualityCheckResult[] = [];
    
    // 1. Claude AI Analysis
    const claudeResult = await validateWithClaude(content, anthropic);
    results.push(claudeResult);
    
    // 2. Basic Markdown Structure Check
    const structureResult = validateMarkdownStructure(content);
    results.push(structureResult);
    
    return results;
  } catch (error) {
    console.error('Error running quality checks:', error);
    throw error;
  }
}

function validateMarkdownStructure(content: string): QualityCheckResult {
  const requiredSections = ['# ', '## ', '### '];
  const missingStructure = requiredSections.filter(section => 
    !content.includes(section)
  );
  
  return {
    passed: missingStructure.length === 0,
    details: missingStructure.length === 0
      ? 'Article structure meets requirements'
      : `Missing required sections: ${missingStructure.join(', ')}`,
    suggestions: missingStructure.length > 0
      ? ['Add proper heading hierarchy using #, ##, and ###']
      : undefined,
  };
} 