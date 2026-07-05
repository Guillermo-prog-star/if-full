package com.integrityfamily.evaluation.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.integrityfamily.domain.Evaluation;
import com.integrityfamily.domain.Family;
import com.integrityfamily.domain.Question;
import com.integrityfamily.domain.repository.EvaluationRepository;
import com.integrityfamily.domain.repository.FamilyRepository;
import com.integrityfamily.domain.repository.QuestionRepository;
import com.integrityfamily.dto.EvaluationDtos;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@SpringBootTest
public class PostmanSimulationTest {

    @Autowired
    private EvaluationService evaluationService;

    @Autowired
    private EvaluationRepository evaluationRepository;

    @Autowired
    private FamilyRepository familyRepository;

    @Autowired
    private QuestionRepository questionRepository;

    @Test
    @Transactional
    public void testPostmanFlow() throws Exception {
        // 1. Obtener la familia principal
        Family family = familyRepository.findAll().get(0);

        // 2. Crear una nueva evaluación limpia
        Evaluation evaluation = new Evaluation();
        evaluation.setFamily(family);
        evaluation.setStatus(com.integrityfamily.domain.EvaluationStatus.IN_PROGRESS);
        evaluation = evaluationRepository.save(evaluation);

        // 3. Buscar las preguntas NEURO_AWARENESS
        List<Question> neuroQuestions = questionRepository.findAll().stream()
                .filter(q -> "NEURO_AWARENESS".equals(q.getType()))
                .collect(Collectors.toList());

        Question qEntry = neuroQuestions.stream().filter(q -> "ENTRY".equals(q.getPhase())).findFirst().orElseThrow();
        Question qTiming = neuroQuestions.stream().filter(q -> "TIMING".equals(q.getPhase())).findFirst().orElseThrow();
        Question qAction = neuroQuestions.stream().filter(q -> "ACTION".equals(q.getPhase())).findFirst().orElseThrow();

        // 4. Armar el request con las respuestas
        List<EvaluationDtos.AnswerDto> answers = List.of(
                new EvaluationDtos.AnswerDto(qEntry.getId(), 0, null),
                new EvaluationDtos.AnswerDto(qTiming.getId(), 4, null),
                new EvaluationDtos.AnswerDto(qAction.getId(), 5, null)
        );

        EvaluationDtos.EvaluationFinalizeRequest request = new EvaluationDtos.EvaluationFinalizeRequest(
                answers, null, null, null
        );

        // 5. Ejecutar la finalización
        EvaluationDtos.FinalizeResult result = evaluationService.finalize(evaluation.getId(), request);

        // 6. Imprimir el JSON final exacto
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());
        mapper.enable(SerializationFeature.INDENT_OUTPUT);
        
        System.out.println("================== JSON FINAL (POSTMAN SIMULATION) ==================");
        System.out.println(mapper.writeValueAsString(result));
        System.out.println("=====================================================================");
    }
}
