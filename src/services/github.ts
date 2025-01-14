import { Octokit } from '@octokit/rest';
import { PullRequestJob, QualityCheckResult } from '../types';

export async function createPRComment(
  job: PullRequestJob,
  results: QualityCheckResult[],
  octokit: Octokit
): Promise<void> {
  const [owner, repo] = job.repository.split('/');
  
  // Format the results into a markdown comment
  const comment = formatResultsComment(results);
  
  try {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: job.prNumber,
      body: comment,
    });
  } catch (error) {
    console.error('Error creating PR comment:', error);
    throw error;
  }
}

function formatResultsComment(results: QualityCheckResult[]): string {
  const overallPassed = results.every(result => result.passed);
  const emoji = overallPassed ? '✅' : '❌';
  
  let comment = `# Article Review Results ${emoji}\n\n`;
  
  // Overall status
  comment += `**Overall Status**: ${overallPassed ? 'Passed' : 'Changes Required'}\n\n`;
  
  // Detailed results
  results.forEach((result, index) => {
    const checkEmoji = result.passed ? '✅' : '❌';
    comment += `## Check ${index + 1} ${checkEmoji}\n\n`;
    comment += `${result.details}\n\n`;
    
    if (result.suggestions?.length) {
      comment += '### Suggestions\n\n';
      result.suggestions.forEach(suggestion => {
        comment += `- ${suggestion}\n`;
      });
      comment += '\n';
    }
  });
  
  // Footer
  comment += '---\n';
  comment += '_This review was performed automatically by the DNI Article Checker bot._\n';
  comment += '_For issues or feedback, please open an issue in the repository._';
  
  return comment;
} 